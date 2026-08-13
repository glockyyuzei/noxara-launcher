//! Concurrent, resumable-by-recheck downloader used for Minecraft client jars,
//! libraries, assets, and loader installers. Verifies sha1 hashes and skips files
//! that already pass verification (spec sections 78/79: don't redownload, cache
//! metadata, use checksums).
//!
//! Cancellation: any batch can be cancelled by task id via `mark_cancelled`. The
//! batch checks the flag between files, each in-flight download checks it per-chunk,
//! and a cancelled download deletes its own partial `.part` file so no corrupted
//! half-written file is left behind looking valid. A cancelled batch returns a
//! `DownloadCancelled` error (RPC code "cancelled") so the Electron side can mark the
//! activity cancelled instead of failed.

use anyhow::{Context, Result};
use futures_util::StreamExt;
use serde::Serialize;
use sha1::{Digest, Sha1};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use crate::protocol::write_event;

/// Marker error reported to the Electron side as RPC code "cancelled".
#[derive(Debug, Clone, Copy)]
pub struct DownloadCancelled;

impl std::fmt::Display for DownloadCancelled {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "download cancelled")
    }
}

impl std::error::Error for DownloadCancelled {}

fn cancelled_registry() -> &'static Mutex<HashSet<String>> {
    static REGISTRY: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Requests cancellation of any in-flight batch sharing `task_id`.
pub fn mark_cancelled(task_id: &str) {
    if let Ok(mut set) = cancelled_registry().lock() {
        set.insert(task_id.to_string());
    }
}

fn is_cancelled(task_id: &str) -> bool {
    cancelled_registry().lock().map(|g| g.contains(task_id)).unwrap_or(false)
}

fn clear_cancelled(task_id: &str) {
    if let Ok(mut set) = cancelled_registry().lock() {
        set.remove(task_id);
    }
}

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
    max_attempts: u32,
    request_timeout: Option<std::time::Duration>,
) -> Result<Vec<String>> {
    let file_count = tasks.len();
    let downloaded_bytes = Arc::new(AtomicU64::new(0));
    let total_bytes: u64 = tasks.iter().filter_map(|t| t.size).sum();
    let failed = Arc::new(std::sync::Mutex::new(Vec::<String>::new()));

    // Cancelled before any work started? Report immediately.
    if is_cancelled(task_id) {
        write_event(
            "download.complete",
            DownloadCompleteEvent {
                task_id: task_id.to_string(),
                failed: vec![],
            },
        );
        return Err(anyhow::Error::new(DownloadCancelled));
    }

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
            if is_cancelled(&task_id) {
                return;
            }

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
            // before giving up on it. A cancellation aborts the retry loop immediately.
            let attempts = max_attempts.max(1);
            let mut last_err = None;
            for attempt in 1..=attempts {
                if is_cancelled(&task_id) {
                    break;
                }
                match download_single(&client, &task, &downloaded_bytes, total_bytes, &task_id, index, file_count, request_timeout).await {
                    Ok(()) => {
                        last_err = None;
                        break;
                    }
                    Err(e) => {
                        if e.downcast_ref::<DownloadCancelled>().is_some() {
                            break;
                        }
                        tracing::warn!("download attempt {attempt}/{attempts} failed for {}: {e:#}", task.label);
                        last_err = Some(e);
                        if attempt < attempts {
                            tokio::time::sleep(std::time::Duration::from_millis(500 * attempt as u64)).await;
                        }
                    }
                }
            }
            if let Some(e) = last_err {
                tracing::warn!("download permanently failed for {} after {attempts} attempts: {e:#}", task.label);
                failed.lock().unwrap().push(task.label.clone());
            }
        });
        handles.push(handle);
    }

    for h in handles {
        let _ = h.await;
    }

    let cancelled = is_cancelled(task_id);
    let failed_list = failed.lock().unwrap().clone();
    write_event(
        "download.complete",
        DownloadCompleteEvent {
            task_id: task_id.to_string(),
            failed: failed_list.clone(),
        },
    );
    // Clear the flag on both terminal paths so the registry stays bounded; task ids are
    // per-operation UUIDs so a reused id is essentially impossible.
    clear_cancelled(task_id);
    if cancelled {
        return Err(anyhow::Error::new(DownloadCancelled));
    }
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
    request_timeout: Option<std::time::Duration>,
) -> Result<()> {
    if let Some(parent) = task.dest.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let tmp_path = task.dest.with_extension("part");
    if is_cancelled(task_id) {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(anyhow::Error::new(DownloadCancelled));
    }

    let mut builder = client.get(&task.url);
    if let Some(t) = request_timeout {
        builder = builder.timeout(t);
    }
    let resp = builder
        .send()
        .await
        .with_context(|| format!("request failed for {}", task.url))?
        .error_for_status()
        .with_context(|| format!("server returned an error for {}", task.url))?;

    let mut file = tokio::fs::File::create(&tmp_path).await?;
    let mut stream = resp.bytes_stream();

    use tokio::io::AsyncWriteExt;
    while let Some(chunk) = stream.next().await {
        if is_cancelled(task_id) {
            // A cancelled download must not leave a corrupted half-written file behind.
            drop(file);
            let _ = tokio::fs::remove_file(&tmp_path).await;
            return Err(anyhow::Error::new(DownloadCancelled));
        }
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

    if is_cancelled(task_id) {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        return Err(anyhow::Error::new(DownloadCancelled));
    }

    if let Some(expected) = &task.sha1 {
        if !expected.is_empty() && !sha1_matches(&tmp_path, expected) {
            let _ = tokio::fs::remove_file(&tmp_path).await;
            anyhow::bail!("sha1 mismatch for {}", task.label);
        }
    }

    tokio::fs::rename(&tmp_path, &task.dest).await?;
    Ok(())
}
