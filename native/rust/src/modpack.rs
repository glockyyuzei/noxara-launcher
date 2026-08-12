//! Modrinth modpack (.mrpack) extraction. The Electron main process downloads the
//! archive, then asks this module to unzip it into a staging directory. Every entry is
//! constrained to stay inside the destination via the zip crate's `enclosed_name()`
//! (blocks `..`/absolute traversal), mirroring the path-safety rules used everywhere
//! else in the launcher.

use anyhow::{Context, Result};
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use zip::ZipArchive;

/// Extracts every entry in `zip_path` into `dest_dir`, returning the list of relative
/// paths written. Skipped entries that escape the destination are simply dropped.
pub async fn extract(zip_path: &str, dest_dir: &str) -> Result<Vec<String>> {
    let file = File::open(zip_path).context("failed to open modpack archive")?;
    let mut archive = ZipArchive::new(file).context("invalid modpack archive")?;
    let dest = Path::new(dest_dir);
    std::fs::create_dir_all(dest)?;

    let mut entries = Vec::with_capacity(archive.len());
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).context("failed to read archive entry")?;
        let Some(enclosed) = entry.enclosed_name() else {
            continue; // unsafe/absolute/.. path — refuse to extract it
        };
        let out_path = dest.join(&enclosed);
        entries.push(enclosed.to_string_lossy().replace('\\', "/"));

        if entry.is_dir() {
            std::fs::create_dir_all(&out_path)?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut out = File::create(&out_path)?;
        let mut buf = [0u8; 64 * 1024];
        loop {
            let n = entry.read(&mut buf)?;
            if n == 0 {
                break;
            }
            out.write_all(&buf[..n])?;
        }
    }
    Ok(entries)
}
