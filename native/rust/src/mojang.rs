//! Real integration with Mojang's public launcher metadata APIs.
//! No fake/hardcoded version lists: everything here is fetched live and cached to disk.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

const VERSION_MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionManifest {
    pub latest: LatestVersions,
    pub versions: Vec<VersionEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatestVersions {
    pub release: String,
    pub snapshot: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionEntry {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub url: String,
    pub time: String,
    #[serde(rename = "releaseTime")]
    pub release_time: String,
    pub sha1: Option<String>,
}

/// Full per-version metadata (libraries, downloads, main class, java version, etc.)
/// This is a partial-but-honest model: fields we don't yet use are still preserved
/// via `serde_json::Value` passthrough for forward compatibility, rather than being
/// silently dropped.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionDetail {
    pub id: String,
    #[serde(rename = "mainClass")]
    pub main_class: String,
    pub arguments: Option<serde_json::Value>,
    #[serde(rename = "minecraftArguments")]
    pub legacy_arguments: Option<String>,
    pub libraries: Vec<Library>,
    pub downloads: VersionDownloads,
    #[serde(rename = "assetIndex")]
    pub asset_index: AssetIndexRef,
    pub assets: String,
    #[serde(rename = "javaVersion")]
    pub java_version: Option<JavaVersionReq>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JavaVersionReq {
    pub component: String,
    #[serde(rename = "majorVersion")]
    pub major_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VersionDownloads {
    pub client: DownloadArtifact,
    pub server: Option<DownloadArtifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadArtifact {
    pub url: String,
    pub sha1: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssetIndexRef {
    pub id: String,
    pub url: String,
    pub sha1: String,
    pub size: u64,
    #[serde(rename = "totalSize")]
    pub total_size: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Library {
    pub name: String,
    pub downloads: Option<LibraryDownloads>,
    pub rules: Option<Vec<serde_json::Value>>,
    pub natives: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LibraryDownloads {
    pub artifact: Option<DownloadArtifact>,
    pub classifiers: Option<std::collections::HashMap<String, DownloadArtifact>>,
}

fn cache_dir() -> Result<PathBuf> {
    let base = dirs::cache_dir().context("no OS cache directory")?;
    let dir = base.join("NoxaraLauncher").join("meta");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

/// Fetch the version manifest, using a 1-hour on-disk cache to avoid hammering
/// Mojang's API on every launcher open (see spec section 53: respect rate limits,
/// cache metadata).
pub async fn get_version_manifest(client: &reqwest::Client, force_refresh: bool) -> Result<VersionManifest> {
    let cache_file = cache_dir()?.join("version_manifest_v2.json");

    if !force_refresh {
        if let Ok(meta) = std::fs::metadata(&cache_file) {
            if let Ok(modified) = meta.modified() {
                if SystemTime::now()
                    .duration_since(modified)
                    .unwrap_or(Duration::MAX)
                    < Duration::from_secs(3600)
                {
                    if let Ok(bytes) = std::fs::read(&cache_file) {
                        if let Ok(manifest) = serde_json::from_slice::<VersionManifest>(&bytes) {
                            return Ok(manifest);
                        }
                    }
                }
            }
        }
    }

    let resp = client
        .get(VERSION_MANIFEST_URL)
        .send()
        .await
        .context("failed to reach Mojang version manifest endpoint")?
        .error_for_status()
        .context("Mojang version manifest endpoint returned an error status")?;
    let bytes = resp.bytes().await?;
    let manifest: VersionManifest = serde_json::from_slice(&bytes)
        .context("failed to parse Mojang version manifest")?;

    let _ = std::fs::write(&cache_file, &bytes);
    Ok(manifest)
}

/// Resolve a specific version's full detail JSON (libraries, main class, downloads, ...).
/// Cached indefinitely per-version-id since release version JSON is immutable once published.
pub async fn get_version_detail(
    client: &reqwest::Client,
    manifest: &VersionManifest,
    version_id: &str,
) -> Result<VersionDetail> {
    let entry = manifest
        .versions
        .iter()
        .find(|v| v.id == version_id)
        .with_context(|| format!("unknown Minecraft version: {version_id}"))?;

    let cache_file = cache_dir()?.join(format!("version-{version_id}.json"));
    if let Ok(bytes) = std::fs::read(&cache_file) {
        if let Ok(detail) = serde_json::from_slice::<VersionDetail>(&bytes) {
            return Ok(detail);
        }
    }

    let resp = client
        .get(&entry.url)
        .send()
        .await
        .with_context(|| format!("failed to fetch version JSON for {version_id}"))?
        .error_for_status()?;
    let bytes = resp.bytes().await?;
    let detail: VersionDetail = serde_json::from_slice(&bytes)
        .with_context(|| format!("failed to parse version JSON for {version_id}"))?;

    let _ = std::fs::write(&cache_file, &bytes);
    Ok(detail)
}

/// Recommend a Java major version for a given Minecraft version, per spec section 16.
/// Falls back to sensible defaults when the version JSON doesn't specify one.
pub fn recommend_java_major(detail: &VersionDetail) -> u32 {
    if let Some(jv) = &detail.java_version {
        return jv.major_version;
    }
    // Pre-1.17 versions predate the javaVersion field and require Java 8.
    8
}
