//! Real integration with Forge's public Maven (https://maven.minecraftforge.net).
//!
//! Forge does not publish a simple "here's a launchable jar" artifact the way Fabric
//! does. Its installer jar bundles an `install_profile.json` describing a set of
//! *processors* — small Java tools (SpecialSource, InstallerTools, binary patchers,
//! etc.) that must actually be executed to produce the patched client jar and final
//! launch libraries. There is no shortcut that both (a) avoids running those tools and
//! (b) produces a client that actually works, so this module runs Forge's own tools
//! exactly as Forge's own installer does, rather than reimplementing binary patching.
//!
//! No hardcoded/fake Forge versions: everything is fetched live from Forge's Maven.

use anyhow::{bail, Context, Result};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::io::Read;
use std::path::Path;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::downloads::{download_batch, DownloadTask};
use crate::maven::maven_coord_to_path;
use crate::mojang::{DownloadArtifact, Library, LibraryDownloads, VersionDetail};
use crate::protocol::write_event;

const MAVEN_BASE: &str = "https://maven.minecraftforge.net";

#[derive(Debug, Clone, Serialize)]
pub struct ForgeVersion {
    pub minecraft_version: String,
    pub forge_version: String,
    /// The exact "<mc>-<forge>[-<branch>]" string Forge's own installer URLs use.
    pub full_version: String,
    pub recommended: bool,
    pub latest: bool,
}

#[derive(Debug, Serialize, Clone)]
pub struct ForgeInstallProgressEvent {
    pub task_id: String,
    pub stage: String,
    pub message: String,
}

fn emit_progress(task_id: &str, stage: &str, message: impl Into<String>) {
    write_event(
        "forge.install.progress",
        ForgeInstallProgressEvent {
            task_id: task_id.to_string(),
            stage: stage.to_string(),
            message: message.into(),
        },
    );
}

/// Lists every published Forge build for `mc_version`, newest first, using Forge's own
/// maven-metadata.xml. A tiny hand-rolled scan is used instead of pulling in a full XML
/// dependency, since we only need the flat list of `<version>` text nodes.
pub async fn get_forge_versions(client: &reqwest::Client, mc_version: &str) -> Result<Vec<ForgeVersion>> {
    let metadata_url = format!("{MAVEN_BASE}/net/minecraftforge/forge/maven-metadata.xml");
    let xml = client
        .get(&metadata_url)
        .send()
        .await
        .context("failed to reach Forge's Maven metadata")?
        .error_for_status()
        .context("Forge's Maven metadata endpoint returned an error")?
        .text()
        .await
        .context("failed to read Forge's Maven metadata")?;

    let mut all_versions: Vec<String> = Vec::new();
    for chunk in xml.split("<version>").skip(1) {
        if let Some(end) = chunk.find("</version>") {
            all_versions.push(chunk[..end].trim().to_string());
        }
    }
    if all_versions.is_empty() {
        bail!("could not parse any versions out of Forge's Maven metadata");
    }

    let prefix = format!("{mc_version}-");
    // maven-metadata.xml lists versions oldest-published-first; reverse for newest-first.
    let matching: Vec<String> = all_versions
        .into_iter()
        .filter(|v| v.starts_with(&prefix))
        .rev()
        .collect();
    if matching.is_empty() {
        bail!("Forge has no published builds for Minecraft {mc_version}");
    }

    // Recommended/latest tags are best-effort: promotions_slim.json doesn't cover every
    // branch, so a miss here just means "not specially marked", never an error.
    #[derive(serde::Deserialize)]
    struct PromotionsSlim {
        promos: HashMap<String, String>,
    }
    let promos: HashMap<String, String> = {
        let resp = client
            .get(format!("{MAVEN_BASE}/net/minecraftforge/forge/promotions_slim.json"))
            .send()
            .await
            .ok()
            .and_then(|r| r.error_for_status().ok());
        match resp {
            Some(r) => r.json::<PromotionsSlim>().await.map(|p| p.promos).unwrap_or_default(),
            None => HashMap::new(),
        }
    };
    let recommended_forge_version = promos.get(&format!("{mc_version}-recommended")).cloned();
    let latest_forge_version = promos.get(&format!("{mc_version}-latest")).cloned();

    let versions = matching
        .into_iter()
        .map(|full_version| {
            let forge_version = full_version
                .strip_prefix(&prefix)
                .unwrap_or(&full_version)
                .to_string();
            ForgeVersion {
                minecraft_version: mc_version.to_string(),
                recommended: recommended_forge_version.as_deref() == Some(forge_version.as_str()),
                latest: latest_forge_version.as_deref() == Some(forge_version.as_str()),
                forge_version,
                full_version,
            }
        })
        .collect();

    Ok(versions)
}

fn classpath_separator() -> &'static str {
    if cfg!(windows) {
        ";"
    } else {
        ":"
    }
}

/// Reads the `Main-Class:` attribute out of a jar's META-INF/MANIFEST.MF.
fn read_main_class(jar_path: &Path) -> Result<String> {
    let file = std::fs::File::open(jar_path)
        .with_context(|| format!("failed to open {}", jar_path.display()))?;
    let mut archive = zip::ZipArchive::new(file)
        .with_context(|| format!("failed to read jar {}", jar_path.display()))?;
    let mut manifest = String::new();
    archive
        .by_name("META-INF/MANIFEST.MF")
        .with_context(|| format!("{} has no MANIFEST.MF", jar_path.display()))?
        .read_to_string(&mut manifest)?;

    for raw_line in manifest.lines() {
        if let Some(value) = raw_line.strip_prefix("Main-Class:") {
            return Ok(value.trim().to_string());
        }
    }
    bail!("{} has no Main-Class manifest attribute", jar_path.display())
}

/// Extracts a single entry from a zip archive on disk to `dest`, creating parent dirs.
fn extract_entry_from_jar(jar_path: &Path, entry_name: &str, dest: &Path) -> Result<()> {
    let file = std::fs::File::open(jar_path)
        .with_context(|| format!("failed to open {}", jar_path.display()))?;
    let mut archive = zip::ZipArchive::new(file)
        .with_context(|| format!("failed to read jar {}", jar_path.display()))?;
    let mut entry = archive
        .by_name(entry_name)
        .with_context(|| format!("{} has no entry {entry_name}", jar_path.display()))?;
    let mut buf = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut buf)?;
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(dest, &buf).with_context(|| format!("failed to write {}", dest.display()))?;
    Ok(())
}

fn read_entry_to_string(jar_path: &Path, entry_name: &str) -> Result<String> {
    let file = std::fs::File::open(jar_path)?;
    let mut archive = zip::ZipArchive::new(file)?;
    let mut entry = archive
        .by_name(entry_name)
        .with_context(|| format!("installer jar has no {entry_name}"))?;
    let mut s = String::new();
    entry.read_to_string(&mut s)?;
    Ok(s)
}

fn jar_has_entry(jar_path: &Path, entry_name: &str) -> bool {
    let Ok(file) = std::fs::File::open(jar_path) else { return false };
    let Ok(mut archive) = zip::ZipArchive::new(file) else { return false };
    let found = archive.by_name(entry_name).is_ok();
    found
}

/// Resolves a Forge `data` table value (or a processor arg token) to a concrete string,
/// per Forge's own installer semantics:
/// - `[group:artifact:version[:classifier]]` -> absolute path under libraries_dir
/// - `/some/path` -> extracted from the installer jar into work_dir, absolute path
/// - anything else -> the literal string
fn resolve_data_value(
    raw: &str,
    installer_jar: &Path,
    libraries_dir: &Path,
    work_dir: &Path,
) -> Result<String> {
    if raw.starts_with('[') && raw.ends_with(']') {
        let coord = &raw[1..raw.len() - 1];
        let rel = maven_coord_to_path(coord);
        return Ok(libraries_dir.join(rel).to_string_lossy().to_string());
    }
    if let Some(entry_path) = raw.strip_prefix('/') {
        let dest = work_dir.join("extracted").join(entry_path);
        if !dest.is_file() {
            extract_entry_from_jar(installer_jar, entry_path, &dest)?;
        }
        return Ok(dest.to_string_lossy().to_string());
    }
    Ok(raw.to_string())
}

/// Downloads (or extracts from the installer jar, for embedded/offline entries) every
/// library the install profile lists, skipping any whose artifact is a processor
/// *output* rather than an input (no usable url and not embedded — those get written
/// by the processors themselves later in the pipeline).
async fn materialize_libraries(
    client: &reqwest::Client,
    task_id: &str,
    libraries: &[Value],
    installer_jar: &Path,
    libraries_dir: &Path,
) -> Result<()> {
    let mut tasks = Vec::new();
    let mut embedded_extracted = 0usize;

    for lib in libraries {
        let Some(name) = lib.get("name").and_then(Value::as_str) else { continue };
        let rel = maven_coord_to_path(name);
        let dest = libraries_dir.join(&rel);
        if dest.is_file() {
            continue;
        }

        let artifact = lib.get("downloads").and_then(|d| d.get("artifact"));
        let url = artifact.and_then(|a| a.get("url")).and_then(Value::as_str).unwrap_or("");

        if !url.is_empty() {
            let sha1 = artifact
                .and_then(|a| a.get("sha1"))
                .and_then(Value::as_str)
                .map(|s| s.to_string());
            let size = artifact.and_then(|a| a.get("size")).and_then(Value::as_u64);
            tasks.push(DownloadTask {
                url: url.to_string(),
                dest,
                sha1,
                size,
                label: name.to_string(),
            });
            continue;
        }

        // No download URL: this is either embedded inside the installer under maven/<path>,
        // or it's an output a later processor step will create. Try embedded first.
        let embedded_entry = format!("maven/{rel}");
        if jar_has_entry(installer_jar, &embedded_entry) {
            extract_entry_from_jar(installer_jar, &embedded_entry, &dest)?;
            embedded_extracted += 1;
        }
        // Otherwise: leave it for the processors to produce. Not an error here.
    }

    if !tasks.is_empty() {
        emit_progress(task_id, "libraries", format!("Downloading {} Forge librar{}…", tasks.len(), if tasks.len() == 1 { "y" } else { "ies" }));
        let failed = download_batch(client, task_id, tasks, 8).await?;
        if !failed.is_empty() {
            bail!("failed to download {} required Forge librar{}: {}", failed.len(), if failed.len() == 1 { "y" } else { "ies" }, failed.join(", "));
        }
    }
    if embedded_extracted > 0 {
        emit_progress(task_id, "libraries", format!("Extracted {embedded_extracted} librar{} bundled in the installer", if embedded_extracted == 1 { "y" } else { "ies" }));
    }

    Ok(())
}

/// Runs every processor in the install profile in order, exactly as Forge's own
/// installer does: resolve each processor's tool jar + classpath, substitute
/// `{DATA_KEY}` and `[maven:coord]` tokens in its args from the data table (plus the
/// builtin SIDE/MINECRAFT_JAR/etc. tokens), then invoke it as `java -cp <cp> <mainClass>
/// <args...>`. A non-zero exit from any processor aborts the install — Forge processors
/// are not optional/best-effort steps.
async fn run_processors(
    task_id: &str,
    java_path: &str,
    processors: &[Value],
    data: &HashMap<String, String>,
    libraries_dir: &Path,
) -> Result<()> {
    let total = processors.len();
    for (index, proc) in processors.iter().enumerate() {
        // A processor with a "sides" list that excludes "client" doesn't apply to us —
        // we only ever install a client-usable instance.
        if let Some(sides) = proc.get("sides").and_then(Value::as_array) {
            let applies = sides.iter().any(|s| s.as_str() == Some("client"));
            if !applies {
                continue;
            }
        }

        let Some(jar_coord) = proc.get("jar").and_then(Value::as_str) else { continue };
        let jar_path = libraries_dir.join(maven_coord_to_path(jar_coord));
        if !jar_path.is_file() {
            bail!("processor tool {jar_coord} is missing at {} (library download step may have failed)", jar_path.display());
        }
        let main_class = read_main_class(&jar_path)
            .with_context(|| format!("could not determine entry point for processor {jar_coord}"))?;

        let mut classpath_parts = vec![jar_path.to_string_lossy().to_string()];
        if let Some(cp) = proc.get("classpath").and_then(Value::as_array) {
            for entry in cp {
                if let Some(coord) = entry.as_str() {
                    classpath_parts.push(
                        libraries_dir
                            .join(maven_coord_to_path(coord))
                            .to_string_lossy()
                            .to_string(),
                    );
                }
            }
        }
        let classpath = classpath_parts.join(classpath_separator());

        let mut args: Vec<String> = Vec::new();
        if let Some(raw_args) = proc.get("args").and_then(Value::as_array) {
            for a in raw_args {
                let Some(s) = a.as_str() else { continue };
                args.push(substitute_processor_token(s, data, libraries_dir));
            }
        }

        emit_progress(
            task_id,
            "processing",
            format!("Running Forge installer step {}/{total} ({jar_coord})", index + 1),
        );

        let mut child = Command::new(java_path)
            .arg("-cp")
            .arg(&classpath)
            .arg(&main_class)
            .args(&args)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!("failed to launch processor {jar_coord}"))?;

        // Stream stdout and stderr concurrently (not sequentially) — a processor that
        // fills both OS pipe buffers at once would otherwise deadlock us reading one
        // stream to completion before ever touching the other, the same hazard
        // launch_and_stream() avoids for the actual game process.
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
        let stdout = child.stdout.take().context("no stdout handle")?;
        let stderr = child.stderr.take().context("no stderr handle")?;

        let tx_out = tx.clone();
        let out_task = tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = tx_out.send(line);
            }
        });
        let tx_err = tx.clone();
        let err_task = tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = tx_err.send(line);
            }
        });
        drop(tx);

        let mut out_lines: Vec<String> = Vec::new();
        while let Some(line) = rx.recv().await {
            emit_progress(task_id, "processing", line.clone());
            out_lines.push(line);
        }
        let _ = out_task.await;
        let _ = err_task.await;

        let status = child.wait().await.context("failed waiting on processor")?;
        if !status.success() {
            let tail = out_lines.iter().rev().take(15).cloned().collect::<Vec<_>>().join("\n");
            bail!("Forge installer step {jar_coord} failed (exit {:?}):\n{tail}", status.code());
        }
    }
    Ok(())
}

/// Resolves a single processor argument token: `{DATA_KEY}` looks up the data table,
/// `[group:artifact:version]` resolves to an absolute library path, anything else is
/// passed through unchanged.
fn substitute_processor_token(raw: &str, data: &HashMap<String, String>, libraries_dir: &Path) -> String {
    if raw.starts_with('{') && raw.ends_with('}') {
        let key = &raw[1..raw.len() - 1];
        return data.get(key).cloned().unwrap_or_else(|| raw.to_string());
    }
    if raw.starts_with('[') && raw.ends_with(']') {
        let coord = &raw[1..raw.len() - 1];
        return libraries_dir
            .join(maven_coord_to_path(coord))
            .to_string_lossy()
            .to_string();
    }
    raw.to_string()
}

fn json_value_to_library(v: &Value) -> Option<Library> {
    let name = v.get("name")?.as_str()?.to_string();
    let downloads = v.get("downloads").map(|d| LibraryDownloads {
        artifact: d.get("artifact").and_then(|a| {
            Some(DownloadArtifact {
                url: a.get("url")?.as_str()?.to_string(),
                sha1: a.get("sha1").and_then(Value::as_str).unwrap_or_default().to_string(),
                size: a.get("size").and_then(Value::as_u64).unwrap_or(0),
            })
        }),
        classifiers: None,
    });
    Some(Library {
        name,
        downloads,
        rules: v.get("rules").and_then(Value::as_array).cloned(),
        natives: None,
    })
}

/// Full modern (1.13+) Forge install: downloads the installer, extracts its embedded
/// `install_profile.json` + `version.json`, resolves every library, runs every
/// processor to produce the patched client, and returns a launchable VersionDetail
/// merged onto the already-resolved vanilla detail for this Minecraft version.
///
/// `vanilla_client_jar` must already exist (the caller ensures vanilla assets are
/// downloaded before calling this, exactly as it does for Fabric).
///
/// The same installer/processor pipeline is shared with NeoForge (its installers are
/// Forge-derived), parameterized via `maven_group_path` / `jar_prefix` / `loader_name`
/// so callers can point at either Maven repository and artifact naming.
#[allow(clippy::too_many_arguments)]
pub async fn install(
    client: &reqwest::Client,
    task_id: &str,
    mc_version: &str,
    full_forge_version: &str,
    java_path: &str,
    libraries_dir: &Path,
    work_dir: &Path,
    vanilla_client_jar: &Path,
    vanilla_detail: &VersionDetail,
    maven_group_path: &str,
    jar_prefix: &str,
    loader_name: &str,
) -> Result<VersionDetail> {
    std::fs::create_dir_all(work_dir).context("failed to create Forge install working directory")?;

    // Forge's processors are expensive (real Java subprocesses, sometimes 10s of
    // seconds each) but fully deterministic for a given (mc, forge) pair — once
    // they've successfully produced this version's libraries there is no reason to
    // ever run them again. A marker file next to the shared libraries dir lets every
    // instance on this version, and every future launch, skip straight to reusing
    // what's already on disk instead of reinstalling on every single launch.
    let marker_path = libraries_dir
        .join(".forge-installed")
        .join(format!("{full_forge_version}.json"));
    if marker_path.is_file() {
        if let Ok(cached) = std::fs::read_to_string(&marker_path) {
            if let Ok(detail) = serde_json::from_str::<VersionDetail>(&cached) {
                emit_progress(task_id, "complete", format!("{loader_name} already installed — reusing it"));
                return Ok(detail);
            }
        }
    }

    let installer_url = format!(
        "{MAVEN_BASE}/{maven_group_path}/{full_forge_version}/{jar_prefix}-{full_forge_version}-installer.jar"
    );
    let installer_path = work_dir.join(format!("{jar_prefix}-{full_forge_version}-installer.jar"));

    emit_progress(task_id, "download", format!("Downloading {loader_name} installer…"));
    if !installer_path.is_file() {
        let resp = client
            .get(&installer_url)
            .send()
            .await
            .with_context(|| format!("failed to download {loader_name} installer from {installer_url}"))?
            .error_for_status()
            .with_context(|| format!("{loader_name} has no installer published at {installer_url} — check the Minecraft/loader version pair"))?;
        let bytes = resp.bytes().await?;
        std::fs::write(&installer_path, &bytes)?;
    }

    if !jar_has_entry(&installer_path, "install_profile.json") {
        bail!(
            "This {loader_name} build ({full_forge_version}) uses a legacy installer format Noxara doesn't support yet. \
             Please pick a newer {loader_name} build for Minecraft {mc_version}."
        );
    }

    let install_profile: Value = serde_json::from_str(&read_entry_to_string(&installer_path, "install_profile.json")?)
        .context("failed to parse install_profile.json")?;

    let version_json_entry = install_profile
        .get("json")
        .and_then(Value::as_str)
        .unwrap_or("/version.json")
        .trim_start_matches('/')
        .to_string();
    let forge_version_json: Value = serde_json::from_str(&read_entry_to_string(&installer_path, &version_json_entry)?)
        .context("failed to parse Forge's bundled version.json")?;

    // Build the data table: resolve each {client, server} pair for its client-side value.
    let mut data: HashMap<String, String> = HashMap::new();
    if let Some(obj) = install_profile.get("data").and_then(Value::as_object) {
        for (key, sides) in obj {
            let raw = sides
                .get("client")
                .and_then(Value::as_str)
                .or_else(|| sides.as_str())
                .unwrap_or_default();
            let resolved = resolve_data_value(raw, &installer_path, libraries_dir, work_dir)?;
            data.insert(key.clone(), resolved);
        }
    }
    data.insert("SIDE".to_string(), "client".to_string());
    data.insert("MINECRAFT_JAR".to_string(), vanilla_client_jar.to_string_lossy().to_string());
    data.insert("MINECRAFT_VERSION".to_string(), mc_version.to_string());
    data.insert("ROOT".to_string(), work_dir.to_string_lossy().to_string());
    data.insert("INSTALLER".to_string(), installer_path.to_string_lossy().to_string());
    data.insert("LIBRARY_DIR".to_string(), libraries_dir.to_string_lossy().to_string());

    // Libraries the install profile itself needs (processor tools + inputs).
    let profile_libraries = install_profile
        .get("libraries")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    materialize_libraries(client, task_id, &profile_libraries, &installer_path, libraries_dir).await?;

    // Libraries the final launch version.json needs (may overlap with the above).
    let launch_libraries = forge_version_json
        .get("libraries")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    materialize_libraries(client, task_id, &launch_libraries, &installer_path, libraries_dir).await?;

    let processors = install_profile
        .get("processors")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if !processors.is_empty() {
        run_processors(task_id, java_path, &processors, &data, libraries_dir).await?;
    }

    emit_progress(task_id, "finalizing", format!("Finalizing {loader_name} version data…"));

    // Merge: forge_version_json wins where it defines a field, vanilla_detail fills the
    // rest — Forge's own version.json normally omits downloads/assetIndex/assets/
    // javaVersion entirely (relying on `inheritsFrom`, which we resolve ourselves here
    // rather than by literally chaining files the way the vanilla launcher does).
    let mut merged = vanilla_detail.clone();
    if let Some(id) = forge_version_json.get("id").and_then(Value::as_str) {
        merged.id = id.to_string();
    }
    if let Some(main_class) = forge_version_json.get("mainClass").and_then(Value::as_str) {
        merged.main_class = main_class.to_string();
    }
    if forge_version_json.get("arguments").is_some() {
        merged.arguments = forge_version_json.get("arguments").cloned();
    }
    if let Some(legacy) = forge_version_json.get("minecraftArguments").and_then(Value::as_str) {
        merged.legacy_arguments = Some(legacy.to_string());
    }

    let mut forge_libs: Vec<Library> = launch_libraries.iter().filter_map(json_value_to_library).collect();
    let mut seen: std::collections::HashSet<String> = forge_libs.iter().map(|l| l.name.clone()).collect();
    for lib in &merged.libraries {
        if seen.insert(lib.name.clone()) {
            forge_libs.push(lib.clone());
        }
    }
    merged.libraries = forge_libs;

    if let Some(parent) = marker_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(serialized) = serde_json::to_string(&merged) {
        let _ = std::fs::write(&marker_path, serialized);
    }

    emit_progress(task_id, "complete", format!("{loader_name} installed"));
    Ok(merged)
}
