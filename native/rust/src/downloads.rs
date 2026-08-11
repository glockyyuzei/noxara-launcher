//! Concurrent, resumable-by-recheck downloader used for Minecraft client jars,
//! libraries, assets, and loader installers. Verifies sha1 hashes and skips files
//! that already pass verification (spec sections 78/79: don't redownload, cache
//! metadata, use checksums).

use anyhow::{Context, Result};
use futures_util::StreamExt;
use serde::Serialize;
use sha1::{Digest, Sha1};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use crate::protocol::write_event;

#[derive(Debug, Clone)]
pub struct DownloadTask {
    pub url: String,
    pub dest: PathBuf,
    pub sha1: Option<String>,
    pub size: Option<u64>,
    pub label: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct DownloadProgressEvent {
    pub task_id: String,
    pub label: String,
    pub bytes_downloaded: u64,
    pub total_bytes: u64,
    pub file_index: usize,
    pub file_count: usize,
}

#[derive(Debug, Serialize, Clone)]
pub struct DownloadCompleteEvent {
    pub task_id: String,
    pub failed: Vec<String>,
}

fn sha1_matches(path: &Path, expected: &str) -> bool {
    let Ok(bytes) = std::fs::read(path) else {
        return false;
    };
    let mut hasher = Sha1::new();
    hasher.update(&bytes);
    let digest = hex::encode(hasher.finalize());
    digest.eq_ignore_ascii_case(expected)
}

/// Downloads a batch of files concurrently (bounded parallelism), verifying hashes,
/// skipping already-valid files, and emitting `download.progress` / `download.complete`
/// events to stdout for the Electron main process to relay to the renderer.
pub async fn download_batch(
    client: &reqwest::Client,
    task_id: &str,
    tasks: Vec<DownloadTask>,
    max_concurrency: usize,
) -> Result<Vec<String>> {
    let file_count = tasks.len();
    let downloaded_bytes = Arc::new(AtomicU64::new(0));
    let total_bytes: u64 = tasks.iter().filter_map(|t| t.size).sum();
    let failed = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));

    let semaphore = Arc::new(tokio::sync::Semaphore::new(max_concurrency.max(1)));
    let mut handles = Vec::with_capacity(tasks.len());

    for (index, task) in tasks.into_iter().enumerate() {
        let client = client.clone();
        let semaphore = Arc::clone(&semaphore);
        let downloaded_bytes = Arc::clone(&downloaded_bytes);
        let failed = Arc::clone(&failed);
        let task_id = task_id.to_string();

        let handle = tokio::spawn(async move {
            let _permit = semaphore.acquire_owned().await.unwrap();

            // Skip re-download if a valid copy already exists. An empty sha1 means the
            // source didn't publish one (e.g. some Fabric libraries) — we still skip if
            // the file merely exists, since there's nothing to verify it against.
            if let Some(expected_sha1) = &task.sha1 {
                let already_present = task.dest.is_file()
                    && (expected_sha1.is_empty() || sha1_matches(&task.dest, expected_sha1));
                if already_present {
                    if let Some(size) = task.size {
                        downloaded_bytes.fetch_add(size, Ordering::Relaxed);
                    }
                    write_event(
                        "download.progress",
                        DownloadProgressEvent {
                            task_id: task_id.clone(),
                            label: task.label.clone(),
                            bytes_downloaded: downloaded_bytes.load(Ordering::Relaxed),
                            total_bytes,
                            file_index: index + 1,
                            file_count,
                        },
                    );
                    return;
                }
            }

            // Transient network hiccups (timeouts, resets) shouldn't permanently fail a
            // file after one bad attempt — retry a couple of times with a short backoff
            // before giving up on it.
            const MAX_ATTEMPTS: u32 = 3;
            let mut last_err = None;
            for attempt in 1..=MAX_ATTEMPTS {
                match download_single(&client, &task, &downloaded_bytes, total_bytes, &task_id, index, file_count).await {
                    Ok(()) => {
                        last_err = None;
                        break;
                    }
                    Err(e) => {
                        tracing::warn!("download attempt {attempt}/{MAX_ATTEMPTS} failed for {}: {e:#}", task.label);
                        last_err = Some(e);
                        if attempt < MAX_ATTEMPTS {
                            tokio::time::sleep(std::time::Duration::from_millis(500 * attempt as u64)).await;
                        }
                    }
                }
            }
            if let Some(e) = last_err {
                tracing::warn!("download permanently failed for {} after {MAX_ATTEMPTS} attempts: {e:#}", task.label);
                failed.lock().unwrap().push(task.label.clone());
            }
        });
        handles.push(handle);
    }

    for h in handles {
        let _ = h.await;
    }

    let failed_list = failed.lock().unwrap().clone();
    write_event(
        "download.complete",
        DownloadCompleteEvent {
            task_id: task_id.to_string(),
            failed: failed_list.clone(),
        },
    );
    Ok(failed_list)
}

async fn download_single(
    client: &reqwest::Client,
    task: &DownloadTask,
    downloaded_bytes: &AtomicU64,
    total_bytes: u64,
    task_id: &str,
    index: usize,
    file_count: usize,
) -> Result<()> {
    if let Some(parent) = task.dest.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let resp = client
        .get(&task.url)
        .send()
        .await
        .with_context(|| format!("request failed for {}", task.url))?
        .error_for_status()
        .with_context(|| format!("server returned an error for {}", task.url))?;

    let tmp_path = task.dest.with_extension("part");
    let mut file = tokio::fs::File::create(&tmp_path).await?;
    let mut stream = resp.bytes_stream();

    use tokio::io::AsyncWriteExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        file.write_all(&chunk).await?;
        let now = downloaded_bytes.fetch_add(chunk.len() as u64, Ordering::Relaxed) + chunk.len() as u64;
        write_event(
            "download.progress",
            DownloadProgressEvent {
                task_id: task_id.to_string(),
                label: task.label.clone(),
                bytes_downloaded: now,
                total_bytes,
                file_index: index + 1,
                file_count,
            },
        );
    }
    file.flush().await?;
    drop(file);

    if let Some(expected) = &task.sha1 {
        if !expected.is_empty() && !sha1_matches(&tmp_path, expected) {
            let _ = tokio::fs::remove_file(&tmp_path).await;
            anyhow::bail!("sha1 mismatch for {}", task.label);
        }
    }

    tokio::fs::rename(&tmp_path, &task.dest).await?;
    Ok(())
}
