//! Real integration with Fabric's public meta API (https://meta.fabricmc.net).
//! No hardcoded loader versions — everything is fetched live.
//!
//! Reliability notes (this used to hang/fail instance creation for older Minecraft
//! versions):
//!   * every meta request gets its own short per-request timeout (the shared client
//!     timeout exists for large downloads and is far too generous for a tiny JSON doc),
//!   * transient failures (connect errors, timeouts, 5xx) are retried with a short
//!     exponential backoff instead of failing the whole RPC on the first hiccup,
//!   * 4xx responses are treated as permanent (e.g. a bogus loader/game-version pair)
//!     and are reported with a stable machine-readable code via `code`,
//!   * an empty loader list is a legitimate result — it means "this Minecraft version
//!     has no Fabric Loader builds", which the Electron side treats as unsupported
//!     rather than a crash.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::time::Duration;

use crate::mojang::{Library, VersionDetail};

const META_BASE: &str = "https://meta.fabricmc.net/v2";
const MAX_ATTEMPTS: u32 = 3;

/// Error codes surfaced over the RPC protocol (`error.code`) so the Electron side can
/// distinguish retryable network failures from hard "this combination is invalid"
/// cases instead of relying on free-form message text.
pub const CODE_NETWORK_ERROR: &str = "fabric.network_error";
pub const CODE_BAD_REQUEST: &str = "fabric.bad_request";
pub const CODE_BAD_RESPONSE: &str = "fabric.bad_response";

/// Structured, stable Fabric meta error. Implements `std::error::Error` so it can be
/// the root cause of an `anyhow::Error` chain and still be recovered with
/// `Error::downcast_ref` on the Electron-facing side.
#[derive(Debug)]
pub struct FabricApiError {
    pub code: &'static str,
    pub message: String,
}

impl std::fmt::Display for FabricApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl std::error::Error for FabricApiError {}

/// Percent-encodes a path segment (game versions / loader versions can contain
/// characters like spaces, e.g. "Alpha v1.2.6").
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

/// Whether this failure is likely transient and worth another attempt. Looks through
/// the whole anyhow chain for a `reqwest::Error`; 5xx statuses are retried, 4xx are not.
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

/// Runs a Fabric meta request up to `attempts` times, retrying transient failures
/// (timeouts, connect errors, 5xx) with a short exponential backoff. Permanent
/// failures (4xx) return immediately so the Electron side can surface a precise error.
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
                    tracing::warn!("Fabric meta request attempt {attempt}/{attempts} failed (retrying): {err:#}");
                    tokio::time::sleep(Duration::from_millis(500 * attempt as u64)).await;
                    last_err = None;
                    continue;
                }
                last_err = Some(err);
                break;
            }
        }
    }
    Err(last_err.unwrap_or_else(|| anyhow::anyhow!("Fabric meta request failed")))
}

/// Converts a generic anyhow error into a stable `FabricApiError` with a code the
/// Electron side can match on.
fn fabric_api_error(err: anyhow::Error) -> FabricApiError {
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
    FabricApiError {
        code,
        message: format!("{err:#}"),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FabricLoaderVersion {
    pub separator: Option<String>,
    pub build: Option<i64>,
    pub maven: String,
    pub version: String,
    pub stable: bool,
}

#[derive(Debug, Deserialize)]
struct LoaderEntry {
    loader: FabricLoaderVersion,
}

/// Lists Fabric loader versions compatible with the given Minecraft version,
/// newest first, as reported by Fabric's own meta API.
///
/// An empty result is NOT an error — it simply means Fabric publishes no loader
/// builds for `game_version` (i.e. this Minecraft version is not Fabric-supported).
pub async fn get_loader_versions(client: &reqwest::Client, game_version: &str) -> Result<Vec<FabricLoaderVersion>> {
    let url = format!("{META_BASE}/versions/loader/{}", encode_path_segment(game_version));

    let entries: Vec<LoaderEntry> = meta_fetch(MAX_ATTEMPTS, || {
        let url = url.clone();
        async move {
        let resp = client
            .get(&url)
            .timeout(Duration::from_secs(30)) // tiny JSON doc — a hung one is a degraded API
            .send()
            .await
            .context("failed to reach Fabric meta API")?
            .error_for_status()
            .with_context(|| format!("Fabric meta API rejected Minecraft {game_version}"))?;
        resp.json().await.context("failed to parse Fabric loader list")
        }
    })
    .await
    .map_err(|e| anyhow::Error::new(fabric_api_error(e)))?;

    Ok(entries.into_iter().map(|e| e.loader).collect())
}

#[derive(Debug, Deserialize)]
struct FabricLaunchMeta {
    #[serde(rename = "mainClass")]
    main_class: FabricMainClass,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum FabricMainClass {
    Simple(String),
    PerSide { client: String },
}

#[derive(Debug, Deserialize)]
struct FabricProfileJson {
    id: String,
    #[serde(rename = "inheritsFrom")]
    inherits_from: String,
    libraries: Vec<FabricLibrary>,
    #[serde(rename = "mainClass")]
    main_class: FabricMainClassField,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum FabricMainClassField {
    Simple(String),
}

#[derive(Debug, Deserialize)]
struct FabricLibrary {
    name: String,
    url: Option<String>,
}

/// Fetches the Fabric "profile" JSON for a given (game version, loader version) pair
/// and merges it onto the vanilla VersionDetail: overrides mainClass, prepends Fabric's
/// own libraries (loader + intermediary + fabric-loader deps) to the vanilla library set.
/// This mirrors exactly what the profile JSON says — nothing is fabricated.
pub async fn build_fabric_version_detail(
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

    let profile: FabricProfileJson = meta_fetch(MAX_ATTEMPTS, || {
        let url = url.clone();
        async move {
        let resp = client
            .get(&url)
            .timeout(Duration::from_secs(30))
            .send()
            .await
            .context("failed to reach Fabric meta API for profile json")?
            .error_for_status()
            .context("Fabric meta API returned an error for this loader/game version pair")?;
        resp.json().await.context("failed to parse Fabric profile json")
        }
    })
    .await
    .map_err(|e| anyhow::Error::new(fabric_api_error(e)))?;

    let FabricMainClassField::Simple(main_class) = profile.main_class;

    let mut merged = vanilla_detail.clone();
    merged.id = profile.id;
    merged.main_class = main_class;

    let mut fabric_libs: Vec<Library> = Vec::with_capacity(profile.libraries.len());
    for lib in profile.libraries {
        let repo_base = lib.url.unwrap_or_else(|| "https://maven.fabricmc.net/".to_string());
        let rel_path = crate::maven::maven_coord_to_path(&lib.name);
        let url = format!("{}{}", repo_base.trim_end_matches('/'), format!("/{rel_path}"));
        fabric_libs.push(Library {
            name: lib.name,
            downloads: Some(crate::mojang::LibraryDownloads {
                artifact: Some(crate::mojang::DownloadArtifact {
                    url,
                    sha1: String::new(), // Fabric's own repo doesn't publish sha1 in this payload;
                    // downloader treats a missing/empty sha1 as "always fetch, don't cache-skip".
                    size: 0,
                }),
                classifiers: None,
            }),
            rules: None,
            natives: None,
        });
    }

    fabric_libs.extend(merged.libraries);
    merged.libraries = fabric_libs;

    Ok(merged)
}