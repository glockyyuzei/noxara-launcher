//! Real integration with NeoForge's public Maven (https://maven.neoforged.net).
//!
//! NeoForge installed two families of builds:
//!   * Minecraft 1.20.1 (the fork point) is published under `net.neoforged:forge`
//!     with full versions like "1.20.1-47.1.106" — structurally identical to Forge.
//!   * Minecraft 1.20.2+ uses the `net.neoforged:neoforge` artifact with versions
//!     like "20.4.237" where the major.minor encodes the Minecraft version
//!     ("20.4" -> 1.20.4, "21.1" -> 1.21.1, "21.0" -> 1.21).
//!
//! Installation reuses Forge's installer/processor pipeline wholesale (NeoForge's
//! installers are Forge-derived), so this module is thin: it discovers builds from
//! the right Maven metadata and delegates to `forge::install` with the correct
//! repository path and jar naming. Nothing here is hardcoded or faked.

use anyhow::{bail, Context, Result};
use serde::Serialize;
use std::path::Path;
use std::time::Duration;

use crate::forge;
use crate::mojang::VersionDetail;

const MAVEN_BASE: &str = "https://maven.neoforged.net/releases";

#[derive(Debug, Clone, Serialize)]
pub struct NeoForgeVersion {
    pub minecraft_version: String,
    pub forge_version: String,
    pub full_version: String,
    pub recommended: bool,
    pub latest: bool,
}

/// A tiny hand-rolled scan of maven-metadata.xml — we only need the flat list of
/// `<version>` text nodes, so no full XML dependency is pulled in (same approach as
/// forge.rs).
async fn fetch_maven_versions(client: &reqwest::Client, artifact_path: &str) -> Result<Vec<String>> {
    let metadata_url = format!("{MAVEN_BASE}/{artifact_path}/maven-metadata.xml");
    let xml = client
        .get(&metadata_url)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .with_context(|| format!("failed to reach NeoForge's Maven metadata ({artifact_path})"))?
        .error_for_status()
        .context("NeoForge's Maven metadata endpoint returned an error")?
        .text()
        .await
        .context("failed to read NeoForge's Maven metadata")?;

    let mut versions: Vec<String> = Vec::new();
    for chunk in xml.split("<version>").skip(1) {
        if let Some(end) = chunk.find("</version>") {
            versions.push(chunk[..end].trim().to_string());
        }
    }
    Ok(versions)
}

/// Maps a Minecraft version id to the NeoForge version *prefix* used in the
/// `net.neoforged:neoforge` artifact ("1.20.4" -> "20.4", "1.21" -> "21.0",
/// "1.21.1" -> "21.1") and, for the fork-point, the literal "1.20.1-".
fn version_prefix_for_mc(mc_version: &str) -> Option<String> {
    if mc_version == "1.20.1" {
        return Some("1.20.1-".to_string());
    }
    let rest = mc_version.strip_prefix("1.")?;
    let parts: Vec<&str> = rest.split('.').collect();
    let major = parts.first()?;
    // "1.21" was published without a ".0" patch, but NeoForge versions use "21.0.x".
    let minor = parts.get(1).copied().unwrap_or("0");
    if major.is_empty() || minor.is_empty() {
        return None;
    }
    Some(format!("{major}.{minor}."))
}

/// Lists every published NeoForge build for `mc_version`, newest first. Version tags
/// (recommended/latest) come from NeoForge's promotions.json when available; a miss
/// only means "not specially tagged".
pub async fn get_neo_forge_versions(client: &reqwest::Client, mc_version: &str) -> Result<Vec<NeoForgeVersion>> {
    let Some(prefix) = version_prefix_for_mc(mc_version) else {
        bail!("NeoForge does not support Minecraft {mc_version}");
    };

    // 1.20.1 lives under net.neoforged:forge; everything else under net.neoforged:neoforge.
    let (artifact_path, is_forge_artifact) = if prefix == "1.20.1-" {
        ("net/neoforged/forge", true)
    } else {
        ("net/neoforged/neoforge", false)
    };

    let all_versions = fetch_maven_versions(client, artifact_path).await?;
    // maven-metadata.xml lists oldest first; reverse for newest-first.
    let matching: Vec<String> = all_versions
        .into_iter()
        .filter(|v| v.starts_with(&prefix))
        .rev()
        .collect();
    if matching.is_empty() {
        bail!("NeoForge has no published builds for Minecraft {mc_version}");
    }

    // Recommended/latest tags are best-effort. NeoForge publishes a promotions file;
    // tolerate both "20.4-recommended" and "1.20.1-recommended" style keys.
    #[derive(serde::Deserialize)]
    struct Promotions {
        #[serde(default)]
        promos: std::collections::HashMap<String, String>,
    }
    let promos: std::collections::HashMap<String, String> = {
        let resp = client
            .get(format!("{MAVEN_BASE}/{artifact_path}/promotions.json"))
            .timeout(Duration::from_secs(20))
            .send()
            .await
            .ok()
            .and_then(|r| r.error_for_status().ok());
        match resp {
            Some(r) => r.json::<Promotions>().await.map(|p| p.promos).unwrap_or_default(),
            None => std::collections::HashMap::new(),
        }
    };

    let strip = prefix.clone();
    let recommended_key = format!("{strip}recommended");
    let latest_key = format!("{strip}latest");

    let versions = matching
        .into_iter()
        .map(|full_version| {
            let forge_version = if is_forge_artifact {
                full_version
                    .strip_prefix(&strip)
                    .unwrap_or(&full_version)
                    .to_string()
            } else {
                // For the neoforge artifact the maven version is already the display
                // version (e.g. "20.4.237"); drop the trailing patch.zip stability marker
                // for a cleaner label by keeping the full version verbatim.
                full_version.clone()
            };
            NeoForgeVersion {
                minecraft_version: mc_version.to_string(),
                recommended: promos.get(&recommended_key).map(String::as_str) == Some(full_version.as_str())
                    || promos.get(&format!("{mc_version}-recommended")).map(String::as_str) == Some(full_version.as_str()),
                latest: promos.get(&latest_key).map(String::as_str) == Some(full_version.as_str())
                    || promos.get(&format!("{mc_version}-latest")).map(String::as_str) == Some(full_version.as_str()),
                forge_version,
                full_version,
            }
        })
        .collect();

    Ok(versions)
}

/// Installs a NeoForge build by reusing Forge's installer/processor pipeline pointed
/// at the NeoForge Maven repository (see also the `neoforge.getVersions` RPC and the
/// parameterized `forge.install` RPC used by the Electron side, which picks the
/// correct `mavenGroupPath`/`jarPrefix` for the chosen build).
pub async fn install(
    client: &reqwest::Client,
    task_id: &str,
    mc_version: &str,
    full_version: &str,
    java_path: &str,
    libraries_dir: &Path,
    work_dir: &Path,
    vanilla_client_jar: &Path,
    vanilla_detail: &VersionDetail,
) -> Result<VersionDetail> {
    let (maven_group_path, jar_prefix) = if full_version.starts_with("1.20.1-") {
        ("net/neoforged/forge", "forge")
    } else {
        ("net/neoforged/neoforge", "neoforge")
    };

    forge::install(
        client,
        task_id,
        mc_version,
        full_version,
        java_path,
        libraries_dir,
        work_dir,
        vanilla_client_jar,
        vanilla_detail,
        maven_group_path,
        jar_prefix,
        "NeoForge",
    )
    .await
}