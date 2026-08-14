//! Real Java runtime detection. Scans PATH, common install locations per OS, and
//! well-known launcher-managed Java directories (Mojang's own bundled runtimes,
//! if present from a vanilla launcher install). No fabricated version lists.
//!
//! Also provides automatic installation of Mojang's official bundled Java runtimes
//! (`java.ensureRuntime`): the same manifests the vanilla launcher uses, downloaded
//! sha1-verified and extracted under the launcher's managed Java directory, so a
//! user with no system Java can still press Play without installing anything.

use anyhow::{anyhow, bail, Context, Result};
use serde::Deserialize;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime};

use crate::downloads::DownloadTask;

/// Mojang's Java runtime product manifest — the exact endpoint the official launcher
/// uses to know which JREs exist per platform. The path hash is stable/published.
const JAVA_RUNTIME_PRODUCT_URL: &str =
    "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";

#[derive(Debug, Clone, Serialize)]
pub struct JavaInstallation {
    pub path: String,
    pub version: String,
    pub major_version: u32,
    pub vendor: Option<String>,
    pub is_64bit: bool,
}

#[derive(Debug, Deserialize)]
struct RuntimeManifestRef {
    url: String,
}

#[derive(Debug, Deserialize)]
struct RuntimeVersion {
    name: String,
}

#[derive(Debug, Deserialize)]
struct RuntimeEntry {
    version: RuntimeVersion,
    manifest: RuntimeManifestRef,
}

/// Product manifest: platform -> component -> candidate runtimes (usually one entry).
type JavaProductManifest = HashMap<String, HashMap<String, Vec<RuntimeEntry>>>;

/// Parses the actual major version from a runtime's version string, e.g.
/// "21.0.7" -> 21, "8u51" -> 8, "16.0.1.9.1" -> 16, "1.8.0_202" -> 8.
fn major_of_version_string(name: &str) -> Option<u32> {
    let s = name.trim();
    if let Some(rest) = s.strip_prefix("1.") {
        // legacy "1.x" scheme
        return rest.split('.').next().and_then(|v| v.parse::<u32>().ok());
    }
    s.split(|c: char| !c.is_ascii_digit())
        .next()
        .and_then(|v| v.parse::<u32>().ok())
        .filter(|m| *m > 0)
}

fn platform_key() -> &'static str {
    if cfg!(windows) {
        "windows-x64"
    } else if cfg!(target_os = "macos") {
        if std::env::consts::ARCH == "aarch64" {
            "mac-os-arm64"
        } else {
            "mac-os"
        }
    } else {
        "linux"
    }
}

fn java_exe_name() -> &'static str {
    if cfg!(windows) {
        "java.exe"
    } else {
        "java"
    }
}

fn runtime_cache_dir() -> Result<PathBuf> {
    let base = dirs::cache_dir().context("no OS cache directory")?;
    let dir = base.join("NoxaraLauncher").join("meta");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

async fn fetch_json(client: &reqwest::Client, url: &str, cache_key: &str, ttl: Duration) -> Result<serde_json::Value> {
    let cache_file = runtime_cache_dir()?.join(format!("java-runtime-{cache_key}.json"));

    if let Ok(meta) = std::fs::metadata(&cache_file) {
        if let Ok(modified) = meta.modified() {
            if SystemTime::now().duration_since(modified).unwrap_or(Duration::MAX) < ttl {
                if let Ok(bytes) = std::fs::read(&cache_file) {
                    if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&bytes) {
                        return Ok(v);
                    }
                }
            }
        }
    }

    let resp = client
        .get(url)
        .send()
        .await
        .with_context(|| format!("failed to reach {url}"))?
        .error_for_status()
        .with_context(|| format!("server returned an error for {url}"))?;
    let bytes = resp.bytes().await?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).context("failed to parse Java runtime JSON")?;
    let _ = std::fs::write(&cache_file, &bytes);
    Ok(value)
}

/// Result of a Java runtime installation attempt.
#[derive(Debug, Serialize)]
pub struct RuntimeInstallResult {
    pub path: String,
    pub component: String,
    pub major_version: u32,
    pub downloaded: bool,
}

/// The path to the java binary of an installed runtime component, if present.
fn installed_java_path(dest_dir: &Path, component: &str) -> Option<PathBuf> {
    let exe = java_exe_name();
    let direct = dest_dir.join(component).join("bin").join(exe);
    if direct.is_file() {
        return Some(direct);
    }
    let nested = dest_dir.join(component).join("jre").join("bin").join(exe);
    if nested.is_file() {
        return Some(nested);
    }
    None
}

/// Marker written only AFTER a runtime install completes fully (all files downloaded,
/// sha1-verified, executable bits applied). Its presence is what distinguishes a
/// complete runtime from a cancelled/partial one.
fn runtime_complete_marker(dest_dir: &Path, component: &str) -> PathBuf {
    dest_dir.join(component).join(".noxara-runtime-complete")
}

/// True when a previously-installed runtime is genuinely complete. A lone
/// `bin/java[.exe]` is NOT enough: a cancelled install can land the binary before the
/// rest of the runtime files, and trusting it would make the next launch fail at spawn.
/// When the marker is missing we re-verify (the batch downloader skips files that
/// already pass sha1, so a partial runtime self-heals cheaply on the next ensure).
fn runtime_installed(dest_dir: &Path, component: &str) -> bool {
    if !runtime_complete_marker(dest_dir, component).is_file() {
        return false;
    }
    installed_java_path(dest_dir, component).is_some()
}

/// Downloads (if needed) Mojang's official Java runtime for `component`/`major_version`
/// into `dest_dir` and returns the absolute java executable path. Reuses an already
/// installed runtime; otherwise downloads the per-file listing sha1-verified (no wrapper
/// archive) into dest/<component>/bin/java[.exe]. `task_id` is forwarded to the batch
/// downloader so progress events update whatever activity the caller registered (e.g.
/// the launch activity).
pub async fn ensure_runtime(
    client: &reqwest::Client,
    component_hint: &str,
    major_version: u32,
    dest_dir: &str,
    task_id: &str,
) -> Result<RuntimeInstallResult> {
    let dest = Path::new(dest_dir);
    std::fs::create_dir_all(dest)?;

    // Already installed for this component? Use it directly (no network needed). Only
    // when the install actually completed (completion marker present) — never trust a
    // lone java binary that a cancelled install may have landed early.
    if !component_hint.is_empty() {
        if runtime_installed(dest, component_hint) {
            if let Some(exe) = installed_java_path(dest, component_hint) {
                return Ok(RuntimeInstallResult {
                    path: exe.to_string_lossy().to_string(),
                    component: component_hint.to_string(),
                    major_version,
                    downloaded: false,
                });
            }
        }
    }

    let product_value = fetch_json(
        client,
        JAVA_RUNTIME_PRODUCT_URL,
        "product",
        Duration::from_secs(3600),
    )
    .await?;
    let product: JavaProductManifest =
        serde_json::from_value(product_value).context("unexpected Java runtime product manifest shape")?;

    let platform = platform_key();
    let platform_runtimes = product
        .get(platform)
        .ok_or_else(|| anyhow!("no Java runtime published for platform {platform}"))?;

    // Prefer the exact component Mojang's version JSON asked for (when it exists in
    // the manifest today); otherwise resolve by the actual Java major published per
    // component — component names get reshuffled (delta = 21, epsilon = 25 now, and
    // jre-legacy is Java 8), so never hardcode a name-to-major map.
    let component = {
        let exact = (!component_hint.is_empty() && platform_runtimes.contains_key(component_hint))
            .then_some(component_hint.to_string());
        exact.or_else(|| {
            let by_major: Vec<(&String, u32)> = platform_runtimes
                .iter()
                .filter_map(|(name, entries)| {
                    let major = entries
                        .first()
                        .and_then(|e| major_of_version_string(&e.version.name))?;
                    Some((name, major))
                })
                .collect();
            // Exact major first, then the smallest major >= required, then newest overall.
            by_major
                .iter()
                .find(|(_, m)| *m == major_version)
                .or_else(|| by_major.iter().filter(|(_, m)| *m >= major_version).min_by_key(|(_, m)| *m))
                .or_else(|| by_major.iter().max_by_key(|(_, m)| *m))
                .map(|(name, _)| (*name).clone())
        })
        .ok_or_else(|| {
            anyhow!("no Java runtime available for Java {major_version} on {platform}; install one manually")
        })?
    };

    // Fast path: already present for the resolved component (and fully installed).
    if runtime_installed(dest, &component) {
        if let Some(exe) = installed_java_path(dest, &component) {
            return Ok(RuntimeInstallResult {
                path: exe.to_string_lossy().to_string(),
                component,
                major_version,
                downloaded: false,
            });
        }
    }

    let entry = platform_runtimes
        .get(&component)
        .and_then(|entries| entries.first())
        .ok_or_else(|| anyhow!("runtime component {component} disappeared from manifest"))?;
    let manifest_url = entry.manifest.url.clone();
    let manifest_value = fetch_json(client, &manifest_url, &format!("runtime-{component}"), Duration::from_secs(3600))
        .await?;

    let files = manifest_value
        .get("files")
        .and_then(|v| v.as_object())
        .context("runtime manifest has no files map")?;

    // The runtime manifest is a per-file listing (bin/, conf/, legal/, lib/, ...) with no
    // wrapper archive — download each file directly into dest/<component>/<relative path>,
    // so the layout matches installed_java_path() (dest/<component>/bin/java[.exe]).
    let component_dir = dest.join(&component);
    std::fs::create_dir_all(&component_dir)?;

    let mut tasks: Vec<DownloadTask> = Vec::with_capacity(files.len());
    for (name, entry) in files {
        if entry.get("type").and_then(|t| t.as_str()) == Some("directory") {
            continue;
        }
        let raw = entry
            .get("downloads")
            .and_then(|d| d.get("raw"))
            .context("file has no raw download")?;
        let Some(url) = raw.get("url").and_then(|v| v.as_str()) else {
            continue; // e.g. symlinks / non-file entries
        };
        let sha1 = raw.get("sha1").and_then(|v| v.as_str()).map(|s| s.to_string());
        let size = raw.get("size").and_then(|v| v.as_u64());
        tasks.push(DownloadTask {
            url: url.to_string(),
            dest: component_dir.join(name),
            sha1,
            size,
            label: format!("Java {major_version}: {name}"),
        });
    }
    if tasks.is_empty() {
        bail!("runtime manifest for {component} contains no downloadable files");
    }

    // Reuses the batch downloader: skips already-valid files, streams progress events to
    // the caller's activity/task id, and bounds concurrency.
    let failed = crate::downloads::download_batch(client, task_id, tasks, 8, 3, None).await?;
    if !failed.is_empty() {
        bail!(
            "failed to download {} of {} Java {major_version} runtime files",
            failed.len(),
            files.len()
        );
    }

    // Apply executable bits on Unix where the manifest marks them.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        for (name, entry) in files {
            if entry.get("executable").and_then(|v| v.as_bool()) != Some(true) {
                continue;
            }
            let path = component_dir.join(name);
            if let Ok(meta) = std::fs::metadata(&path) {
                let mut perms = meta.permissions();
                perms.set_mode(perms.mode() | 0o111);
                let _ = std::fs::set_permissions(&path, perms);
            }
        }
    }

    // Everything downloaded and verified — now mark the runtime complete so the fast
    // path can trust it later. The marker is written only after success, so a cancelled
    // install never reads back as "installed".
    let _ = std::fs::write(runtime_complete_marker(dest, &component), b"ok\n");

    let exe = installed_java_path(dest, &component)
        .ok_or_else(|| anyhow!("Java runtime installed but java binary is missing"))?;

    tracing::info!("installed Java runtime {component} -> {}", exe.display());

    Ok(RuntimeInstallResult {
        path: exe.to_string_lossy().to_string(),
        component,
        major_version,
        downloaded: true,
    })
}

/// Scans PATH/JAVA_HOME/common install dirs for JVMs and probes each one. Each probe
/// spawns a real `java -version` subprocess (tens to hundreds of ms), so this runs on a
/// blocking worker rather than stalling the async runtime during a detect-Java call.
pub async fn detect_all() -> Vec<JavaInstallation> {
    tokio::task::spawn_blocking(detect_all_sync)
        .await
        .unwrap_or_default()
}

fn detect_all_sync() -> Vec<JavaInstallation> {
    let mut candidates: HashSet<PathBuf> = HashSet::new();

    if let Ok(path_var) = std::env::var("PATH") {
        let exe_name = if cfg!(windows) { "java.exe" } else { "java" };
        for dir in std::env::split_paths(&path_var) {
            let candidate = dir.join(exe_name);
            if candidate.is_file() {
                candidates.insert(candidate);
            }
        }
    }

    if let Ok(java_home) = std::env::var("JAVA_HOME") {
        let bin = PathBuf::from(&java_home)
            .join("bin")
            .join(if cfg!(windows) { "java.exe" } else { "java" });
        if bin.is_file() {
            candidates.insert(bin);
        }
    }

    for dir in platform_search_dirs() {
        scan_dir_for_java(&dir, &mut candidates);
    }

    let mut results: Vec<JavaInstallation> = candidates
        .into_iter()
        .filter_map(|p| probe_java_binary(&p))
        .collect();

    results.sort_by(|a, b| a.major_version.cmp(&b.major_version).then(a.path.cmp(&b.path)));
    results.dedup_by(|a, b| a.path == b.path);
    results
}

fn platform_search_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if cfg!(windows) {
        for env_var in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
            if let Ok(base) = std::env::var(env_var) {
                dirs.push(PathBuf::from(&base).join("Java"));
                dirs.push(PathBuf::from(&base).join("Eclipse Adoptium"));
                dirs.push(PathBuf::from(&base).join("Microsoft"));
            }
        }
        if let Ok(appdata) = std::env::var("APPDATA") {
            dirs.push(PathBuf::from(appdata).join(".noxara").join("java"));
        }
    } else if cfg!(target_os = "macos") {
        dirs.push(PathBuf::from("/Library/Java/JavaVirtualMachines"));
        dirs.push(PathBuf::from("/opt/homebrew/opt"));
        dirs.push(PathBuf::from("/usr/local/opt"));
        if let Some(home) = dirs::home_dir() {
            dirs.push(home.join("Library/Application Support/NoxaraLauncher/java"));
        }
    } else {
        dirs.push(PathBuf::from("/usr/lib/jvm"));
        dirs.push(PathBuf::from("/usr/lib64/jvm"));
        dirs.push(PathBuf::from("/opt/jdk"));
        if let Some(home) = dirs::home_dir() {
            dirs.push(home.join(".noxara").join("java"));
            dirs.push(home.join(".sdkman/candidates/java"));
        }
    }

    dirs
}

/// Non-recursive shallow scan: look one or two levels down for a `bin/java(.exe)`.
/// Covers system JVMs (jdk-X/bin), macOS bundles (Contents/Home/bin) and Noxara's
/// own managed runtimes (components/<component>/jre/bin).
fn scan_dir_for_java(dir: &Path, out: &mut HashSet<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let exe_name = if cfg!(windows) { "java.exe" } else { "java" };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        // macOS JVM bundles nest under Contents/Home/bin
        let mac_nested = path.join("Contents/Home/bin").join(exe_name);
        if mac_nested.is_file() {
            out.insert(mac_nested);
            continue;
        }
        let direct = path.join("bin").join(exe_name);
        if direct.is_file() {
            out.insert(direct);
            continue;
        }
        // Mojang-style managed runtime: <component>/jre/bin/java
        let managed = path.join("jre").join("bin").join(exe_name);
        if managed.is_file() {
            out.insert(managed);
        }
    }
}

/// Runs `java -version` and parses vendor/version/bitness from stderr, since the JVM
/// prints its version banner to stderr by convention.
pub fn probe_java_binary(path: &Path) -> Option<JavaInstallation> {
    let output = Command::new(path).arg("-version").output().ok()?;
    let banner = String::from_utf8_lossy(&output.stderr);
    let banner = if banner.trim().is_empty() {
        String::from_utf8_lossy(&output.stdout).to_string()
    } else {
        banner.to_string()
    };

    let version = extract_quoted_version(&banner)?;
    let major_version = parse_major_version(&version);
    let vendor = if banner.contains("OpenJDK") {
        Some("OpenJDK".to_string())
    } else if banner.contains("Java(TM)") || banner.contains("HotSpot") {
        Some("Oracle".to_string())
    } else {
        None
    };
    let is_64bit = banner.contains("64-Bit");

    Some(JavaInstallation {
        path: path.to_string_lossy().to_string(),
        version,
        major_version,
        vendor,
        is_64bit,
    })
}

fn extract_quoted_version(banner: &str) -> Option<String> {
    let start = banner.find('"')? + 1;
    let rest = &banner[start..];
    let end = rest.find('"')?;
    Some(rest[..end].to_string())
}

/// Handles both old-style ("1.8.0_392") and new-style ("21.0.3", "17") version strings.
fn parse_major_version(version: &str) -> u32 {
    let parts: Vec<&str> = version.split('.').collect();
    if parts.is_empty() {
        return 0;
    }
    if parts[0] == "1" && parts.len() > 1 {
        // legacy scheme: 1.8.0_392 -> major 8
        parts[1].parse().unwrap_or(0)
    } else {
        parts[0].parse().unwrap_or(0)
    }
}

/// Probes a single Java binary (`java -version` subprocess); runs on a blocking worker
/// so a slow or hung JVM probe never blocks the async runtime.
pub async fn test_java_path(path: &str) -> Option<JavaInstallation> {
    let path = path.to_string();
    tokio::task::spawn_blocking(move || probe_java_binary(Path::new(&path)))
        .await
        .unwrap_or(None)
}
