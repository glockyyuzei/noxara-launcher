//! Real integration with Quilt's public meta API (https://meta.quiltmc.org/v3).
//! Mirrors the Fabric flow: loaders are discovered from Quilt's meta endpoint and a
//! (game version, loader version) pair is resolved into a launchable VersionDetail by
//! fetching Quilt's own profile json and merging its main class + libraries onto the
//! vanilla detail.
//!
//! Reliability model is identical to fabric.rs: short per-request timeouts, retries
//! with backoff for transient failures, stable machine-readable error codes, and an
//! empty loader list meaning "this Minecraft version has no Quilt Loader builds".

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::mojang::{Library, VersionDetail};

const META_BASE: &str = "https://meta.quiltmc.org/v3";
const MAX_ATTEMPTS: u32 = 3;

pub const CODE_NETWORK_ERROR: &str = "quilt.network_error";
pub const CODE_BAD_REQUEST: &str = "quilt.bad_request";
pub const CODE_BAD_RESPONSE: &str = "quilt.bad_response";

#[derive(Debug)]
pub struct QuiltApiError {
    pub code: &'static str,
    pub message: String,
}

impl std::fmt::Display for QuiltApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for QuiltApiError {}

fn encode_path_segment(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn is_retryable(err: &anyhow::Error) -> bool {
    if let Some(req) = err.downcast_ref::<reqwest::Error>() {
        if req.is_timeout() || req.is_connect() || req.is_request() {
            return true;
        }
        if let Some(status) = req.status() {
            return status.is_server_error();
        }
    }
    false
}

async fn meta_fetch<T, F, Fut>(attempts: u32, run: F) -> Result<T>
where
    T: serde::de::DeserializeOwned,
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Result<T>>,
{
    let mut last_err: Option<anyhow::Error> = None;
    for attempt in 1..=attempts {
        match run().await {
            Ok(value) => return Ok(value),
            Err(err) => {
                if is_retryable(&err) && attempt < attempts {
                    tracing::warn!("Quilt meta request attempt {attempt}/{attempts} failed (retrying): {err:#}");
                    tokio::time::sleep(Duration::from_millis(500 * attempt as u64)).await;
                    last_err = None;
                    continue;
                }
                last_err = Some(err);
                break;
            }
        }
    }
    Err(last_err.unwrap_or_else(|| anyhow::anyhow!("Quilt meta request failed")))
}

fn quilt_api_error(err: anyhow::Error) -> QuiltApiError {
    let code = if is_retryable(&err) {
        CODE_NETWORK_ERROR
    } else if let Some(req) = err.downcast_ref::<reqwest::Error>() {
        if let Some(status) = req.status() {
            if status.is_client_error() {
                CODE_BAD_REQUEST
            } else {
                CODE_NETWORK_ERROR
            }
        } else {
            CODE_NETWORK_ERROR
        }
    } else if err.root_cause().to_string().contains("parse") {
        CODE_BAD_RESPONSE
    } else {
        CODE_NETWORK_ERROR
    };
    QuiltApiError {
        code,
        message: format!("{err:#}"),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuiltLoaderVersion {
    pub separator: Option<String>,
    pub build: Option<i64>,
    pub maven: String,
    pub version: String,
    pub stable: bool,
}

#[derive(Debug, Deserialize)]
struct LoaderEntry {
    loader: QuiltLoaderVersion,
}

/// Lists Quilt Loader versions compatible with the given Minecraft version, newest
/// first. An empty result is not an error — it means Quilt publishes no loader builds
/// for `game_version`.
pub async fn get_loader_versions(client: &reqwest::Client, game_version: &str) -> Result<Vec<QuiltLoaderVersion>> {
    let url = format!("{META_BASE}/versions/loader/{}", encode_path_segment(game_version));

    let entries: Vec<LoaderEntry> = meta_fetch(MAX_ATTEMPTS, || {
        let url = url.clone();
        async move {
            let resp = client
                .get(&url)
                .timeout(Duration::from_secs(30))
                .send()
                .await
                .context("failed to reach Quilt meta API")?
                .error_for_status()
                .with_context(|| format!("Quilt meta API rejected Minecraft {game_version}"))?;
            resp.json().await.context("failed to parse Quilt loader list")
        }
    })
    .await
    .map_err(|e| anyhow::Error::new(quilt_api_error(e)))?;

    Ok(entries.into_iter().map(|e| e.loader).collect())
}

#[derive(Debug, Deserialize)]
struct QuiltProfileJson {
    id: String,
    #[serde(rename = "inheritsFrom")]
    inherits_from: String,
    libraries: Vec<QuiltLibrary>,
    #[serde(rename = "mainClass")]
    main_class: String,
}

#[derive(Debug, Deserialize)]
struct QuiltLibrary {
    name: String,
    url: Option<String>,
    #[serde(default)]
    sha1: Option<String>,
    #[serde(default)]
    size: Option<u64>,
}

/// Fetches Quilt's profile json for a (game version, loader version) pair and merges
/// it onto the vanilla VersionDetail, mirroring the Fabric flow. Quilt's meta lists
/// libraries with an explicit repository `url` and optional `sha1`/`size` per entry.
pub async fn build_quilt_version_detail(
    client: &reqwest::Client,
    vanilla_detail: &VersionDetail,
    game_version: &str,
    loader_version: &str,
) -> Result<VersionDetail> {
    let url = format!(
        "{META_BASE}/versions/loader/{}/{}/profile/json",
        encode_path_segment(game_version),
        encode_path_segment(loader_version),
    );

    let profile: QuiltProfileJson = meta_fetch(MAX_ATTEMPTS, || {
        let url = url.clone();
        async move {
            let resp = client
                .get(&url)
                .timeout(Duration::from_secs(30))
                .send()
                .await
                .context("failed to reach Quilt meta API for profile json")?
                .error_for_status()
                .context("Quilt meta API returned an error for this loader/game version pair")?;
            resp.json().await.context("failed to parse Quilt profile json")
        }
    })
    .await
    .map_err(|e| anyhow::Error::new(quilt_api_error(e)))?;

    let mut merged = vanilla_detail.clone();
    merged.id = profile.id;
    merged.main_class = profile.main_class;

    let mut quilt_libs: Vec<Library> = Vec::with_capacity(profile.libraries.len());
    for lib in profile.libraries {
        let repo_base = lib.url.unwrap_or_else(|| "https://maven.quiltmc.org/repository/release/".to_string());
        let rel_path = crate::maven::maven_coord_to_path(&lib.name);
        let url = format!("{}{}", repo_base.trim_end_matches('/'), format!("/{rel_path}"));
        quilt_libs.push(Library {
            name: lib.name,
            downloads: Some(crate::mojang::LibraryDownloads {
                artifact: Some(crate::mojang::DownloadArtifact {
                    url,
                    sha1: lib.sha1.unwrap_or_default(),
                    size: lib.size.unwrap_or(0),
                }),
                classifiers: None,
            }),
            rules: None,
            natives: None,
        });
    }

    quilt_libs.extend(merged.libraries);
    merged.libraries = quilt_libs;

    Ok(merged)
}