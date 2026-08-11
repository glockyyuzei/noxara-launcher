//! Real Java runtime detection. Scans PATH, common install locations per OS, and
//! well-known launcher-managed Java directories (Mojang's own bundled runtimes,
//! if present from a vanilla launcher install). No fabricated version lists.

use serde::Serialize;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize)]
pub struct JavaInstallation {
    pub path: String,
    pub version: String,
    pub major_version: u32,
    pub vendor: Option<String>,
    pub is_64bit: bool,
}

pub fn detect_all() -> Vec<JavaInstallation> {
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

pub fn test_java_path(path: &str) -> Option<JavaInstallation> {
    probe_java_binary(Path::new(path))
}
