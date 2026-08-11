//! Extracts platform-specific native libraries (LWJGL etc.) from their jar files into
//! an instance's natives directory, so -Djava.library.path can find them at launch.
//! Needed for Minecraft versions that ship natives as separate classifier jars rather
//! than bundling them directly into the regular library jar.

use anyhow::{Context, Result};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

/// Extracts every file in each jar (except META-INF/*) directly into `dest_dir`,
/// skipping directory entries and any path that would escape dest_dir.
pub fn extract_natives(jar_paths: &[PathBuf], dest_dir: &Path) -> Result<()> {
    fs::create_dir_all(dest_dir).context("failed to create natives directory")?;

    for jar_path in jar_paths {
        let file = fs::File::open(jar_path)
            .with_context(|| format!("failed to open natives jar {}", jar_path.display()))?;
        let mut archive = zip::ZipArchive::new(file)
            .with_context(|| format!("failed to read natives jar {}", jar_path.display()))?;

        for i in 0..archive.len() {
            let mut entry = archive.by_index(i)?;
            let name = entry.name().to_string();

            if entry.is_dir() || name.starts_with("META-INF") {
                continue;
            }

            // Native jars are flat (files at jar root, e.g. "lwjgl.dll"); guard against
            // any unexpected nested/traversal path the same way archive extraction
            // elsewhere in the app does.
            let file_name = match Path::new(&name).file_name() {
                Some(f) => f,
                None => continue,
            };
            let dest_path = dest_dir.join(file_name);

            let mut buf = Vec::with_capacity(entry.size() as usize);
            entry.read_to_end(&mut buf)?;
            fs::write(&dest_path, &buf)
                .with_context(|| format!("failed to write native file {}", dest_path.display()))?;
        }
    }

    Ok(())
}
