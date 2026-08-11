//! Real integration with Fabric's public meta API (https://meta.fabricmc.net).
//! No hardcoded loader versions — everything is fetched live, per spec section 15.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

use crate::mojang::{Library, VersionDetail};

const META_BASE: &str = "https://meta.fabricmc.net/v2";

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
pub async fn get_loader_versions(client: &reqwest::Client, game_version: &str) -> Result<Vec<FabricLoaderVersion>> {
    let url = format!("{META_BASE}/versions/loader/{game_version}");
    let resp = client
        .get(&url)
        .send()
        .await
        .context("failed to reach Fabric meta API")?
        .error_for_status()
        .with_context(|| format!("Fabric meta API returned an error for Minecraft {game_version}"))?;
    let entries: Vec<LoaderEntry> = resp.json().await.context("failed to parse Fabric loader list")?;
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
    let url = format!("{META_BASE}/versions/loader/{game_version}/{loader_version}/profile/json");
    let resp = client
        .get(&url)
        .send()
        .await
        .context("failed to reach Fabric meta API for profile json")?
        .error_for_status()
        .context("Fabric meta API returned an error for this loader/game version pair")?;
    let profile: FabricProfileJson = resp.json().await.context("failed to parse Fabric profile json")?;

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
