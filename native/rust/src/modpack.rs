//! Modrinth modpack (.mrpack) extraction and creation. The Electron main process
//! downloads the archive, then asks this module to unzip it into a staging directory.
//! Every entry is constrained to stay inside the destination via the zip crate's
//! `enclosed_name()` (blocks `..`/absolute traversal), mirroring the path-safety rules
//! used everywhere else in the launcher.
//!
//! Creation is the inverse: the main process writes `modrinth.index.json` and prepares
//! an `overrides/` tree, and this module zips the two together into the final archive.

use anyhow::{Context, Result};
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

/// Zip-bomb guards for `.mrpack` extraction. A hostile archive can claim tiny
/// compressed sizes but inflate enormously; cap both the number of entries and the
/// total uncompressed bytes so extracting can't exhaust disk or memory. Legit modpacks
/// are well under these limits (a large modpack is a few hundred MB across a few
/// thousand files).
const MAX_ENTRIES: usize = 10_000;
const MAX_TOTAL_UNCOMPRESSED_BYTES: u64 = 4 * 1024 * 1024 * 1024;

/// Extracts every entry in `zip_path` into `dest_dir`, returning the list of relative
/// paths written. Skipped entries that escape the destination are simply dropped.
/// Runs on a blocking worker so a large archive never stalls the async runtime.
pub async fn extract(zip_path: &str, dest_dir: &str) -> Result<Vec<String>> {
    let zip_path = zip_path.to_string();
    let dest_dir = dest_dir.to_string();
    tokio::task::spawn_blocking(move || extract_sync(&zip_path, &dest_dir))
        .await
        .context("modpack extraction task failed")?
}

fn extract_sync(zip_path: &str, dest_dir: &str) -> Result<Vec<String>> {
    let file = File::open(zip_path).context("failed to open modpack archive")?;
    let mut archive = ZipArchive::new(file).context("invalid modpack archive")?;
    let dest = Path::new(dest_dir);
    std::fs::create_dir_all(dest)?;

    if archive.len() > MAX_ENTRIES {
        anyhow::bail!("modpack archive has too many entries ({} > {MAX_ENTRIES})", archive.len());
    }

    let mut entries = Vec::with_capacity(archive.len());
    let mut total_uncompressed: u64 = 0;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).context("failed to read archive entry")?;
        let Some(enclosed) = entry.enclosed_name() else {
            continue; // unsafe/absolute/.. path — refuse to extract it
        };

        // Sum the declared uncompressed sizes before writing anything, so an archive
        // that claims to be gigantic is rejected without inflating any of it.
        total_uncompressed = total_uncompressed.saturating_add(entry.size());
        if total_uncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES {
            anyhow::bail!("modpack archive is too large to extract safely");
        }

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
            // The central-directory size can be lied about; enforce the cap against
            // what actually decompressed out, not just what the header claimed.
            total_uncompressed = total_uncompressed.saturating_add(n as u64);
            if total_uncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES {
                anyhow::bail!("modpack archive is too large to extract safely");
            }
            out.write_all(&buf[..n])?;
        }
    }
    Ok(entries)
}

/// Zips `index_path` (written at `modrinth.index.json` inside the archive) plus every
/// file under `overrides_dir` (nested under an `overrides/` folder) into `zip_path`.
/// Directory entries are recreated implicitly by file entries, so empty directories
/// under overrides are intentionally not preserved. Runs on a blocking worker.
pub async fn create(zip_path: &str, index_path: &str, overrides_dir: &str) -> Result<()> {
    let zip_path = zip_path.to_string();
    let index_path = index_path.to_string();
    let overrides_dir = overrides_dir.to_string();
    tokio::task::spawn_blocking(move || create_sync(&zip_path, &index_path, &overrides_dir))
        .await
        .context("modpack creation task failed")?
}

fn create_sync(zip_path: &str, index_path: &str, overrides_dir: &str) -> Result<()> {
    let file = File::create(zip_path).context("failed to create modpack archive")?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

    zip.start_file("modrinth.index.json", options)?;
    let mut index = File::open(index_path).context("failed to open modrinth.index.json")?;
    std::io::copy(&mut index, &mut zip)?;

    let override_root = Path::new(overrides_dir);
    if override_root.is_dir() {
        zip_dir(&mut zip, override_root, override_root, "overrides", &options)?;
    }

    let _ = zip.finish()?;
    Ok(())
}

/// Zips every file under `source_dir` into `zip_path` with no path prefix — a
/// faithful, restore-able snapshot of a directory (used for instance backups).
/// Directory entries are recreated implicitly by file entries. Runs on a blocking worker.
pub async fn create_directory_archive(zip_path: &str, source_dir: &str) -> Result<()> {
    let zip_path = zip_path.to_string();
    let source_dir = source_dir.to_string();
    tokio::task::spawn_blocking(move || create_directory_archive_sync(&zip_path, &source_dir))
        .await
        .context("backup archive task failed")?
}

fn create_directory_archive_sync(zip_path: &str, source_dir: &str) -> Result<()> {
    let file = File::create(zip_path).context("failed to create backup archive")?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let root = Path::new(source_dir);
    if root.is_dir() {
        zip_dir(&mut zip, root, root, "", &options)?;
    }
    let _ = zip.finish()?;
    Ok(())
}

/// Recursively writes every file under `dir` into the zip, path-prefixed with `rel`.
fn zip_dir(
    zip: &mut ZipWriter<File>,
    base: &Path,
    dir: &Path,
    prefix: &str,
    options: &SimpleFileOptions,
) -> Result<()> {
    for entry in std::fs::read_dir(dir)?.flatten() {
        let path = entry.path();
        let ft = entry.file_type().context("failed to read entry type")?;
        if ft.is_dir() {
            zip_dir(zip, base, &path, prefix, options)?;
            continue;
        }
        if !ft.is_file() {
            continue;
        }
        let rel = path
            .strip_prefix(base)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let mut out = String::from(prefix);
        if !out.is_empty() {
            out.push('/');
        }
        out.push_str(&rel);

        zip.start_file(out, *options)?;
        let mut f = File::open(&path)?;
        std::io::copy(&mut f, zip)?;
    }
    Ok(())
}
