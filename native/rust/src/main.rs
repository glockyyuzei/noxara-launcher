mod downloads;
mod fabric;
mod forge;
mod java;
mod launch;
mod maven;
mod modpack;
mod mojang;
mod natives;
mod neoforge;
mod protocol;
mod quilt;

use protocol::{write_event, write_response, RpcRequest, RpcResponse};
use serde_json::json;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::fabric::FabricApiError;
use crate::quilt::QuiltApiError;

/// Turns any error into a stable, machine-readable RPC code. Loader services attach
/// their own codes (e.g. `fabric.network_error`, `quilt.network_error`); anything that
/// bottoms out in a `reqwest::Error` (e.g. the Mojang manifest fetch that a loader
/// detail preflight performs) is reported as `network_error` so the Electron side can
/// retry it.
fn classify_error_code(err: &anyhow::Error) -> &'static str {
    if err.downcast_ref::<downloads::DownloadCancelled>().is_some() {
        return "cancelled";
    }
    if let Some(fabric_err) = err.downcast_ref::<FabricApiError>() {
        return fabric_err.code;
    }
    if let Some(quilt_err) = err.downcast_ref::<QuiltApiError>() {
        return quilt_err.code;
    }
    if let Some(req) = err.downcast_ref::<reqwest::Error>() {
        if req.is_timeout() || req.is_connect() || req.is_request() {
            return "network_error";
        }
        if let Some(status) = req.status() {
            if status.is_client_error() {
                return "bad_request";
            }
        }
        return "network_error";
    }
    "internal_error"
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_writer(std::io::stderr) // stdout is reserved for the RPC protocol
        .with_env_filter(std::env::var("NOXARA_LOG").unwrap_or_else(|_| "info".to_string()))
        .init();

    tracing::info!("noxara-core starting");

    let http = Arc::new(
        reqwest::Client::builder()
            .user_agent("NoxaraLauncher/0.1 (+https://noxara.dev)")
            // 30s was too aggressive for larger asset files (music/sound tracks can be
            // several MB) — a slow connection legitimately needs more time per file,
            // and download_single now retries on top of this anyway.
            .timeout(std::time::Duration::from_secs(120))
            .build()?,
    );

    let stdin = tokio::io::stdin();
    let mut lines = BufReader::new(stdin).lines();

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let http = Arc::clone(&http);
        tokio::spawn(async move {
            handle_line(http, &line).await;
        });
    }

    Ok(())
}

async fn handle_line(http: Arc<reqwest::Client>, line: &str) {
    let req: RpcRequest = match serde_json::from_str(line) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("malformed request: {e}");
            return;
        }
    };

    let id = req.id.clone();
    let result = dispatch(&http, &req).await;

    match result {
        Ok(value) => write_response(&RpcResponse::ok(&id, value)),
        Err(e) => {
            let code = classify_error_code(&e);
            write_response(&RpcResponse::err(&id, code, format!("{e:#}")));
        }
    }
}

async fn dispatch(http: &reqwest::Client, req: &RpcRequest) -> anyhow::Result<serde_json::Value> {
    match req.method.as_str() {
        "mojang.getVersionManifest" => {
            let force_refresh = req
                .params
                .get("forceRefresh")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let manifest = mojang::get_version_manifest(http, force_refresh).await?;
            Ok(serde_json::to_value(manifest)?)
        }

        "mojang.getVersionDetail" => {
            let version_id = req
                .params
                .get("versionId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing versionId"))?;
            let manifest = mojang::get_version_manifest(http, false).await?;
            let detail = mojang::get_version_detail(http, &manifest, version_id).await?;
            let recommended_java = mojang::recommend_java_major(&detail);
            Ok(json!({ "detail": detail, "recommendedJavaMajor": recommended_java }))
        }

        "fabric.getLoaderVersions" => {
            let game_version = req
                .params
                .get("gameVersion")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing gameVersion"))?;
            let versions = fabric::get_loader_versions(http, game_version).await?;
            Ok(serde_json::to_value(versions)?)
        }

        "fabric.getVersionDetail" => {
            let game_version = req
                .params
                .get("gameVersion")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing gameVersion"))?;
            let loader_version = req
                .params
                .get("loaderVersion")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing loaderVersion"))?;

            let manifest = mojang::get_version_manifest(http, false).await?;
            let vanilla_detail = mojang::get_version_detail(http, &manifest, game_version).await?;
            let merged = fabric::build_fabric_version_detail(http, &vanilla_detail, game_version, loader_version).await?;
            let recommended_java = mojang::recommend_java_major(&vanilla_detail);
            Ok(json!({ "detail": merged, "recommendedJavaMajor": recommended_java }))
        }

        "quilt.getLoaderVersions" => {
            let game_version = req
                .params
                .get("gameVersion")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing gameVersion"))?;
            let versions = quilt::get_loader_versions(http, game_version).await?;
            Ok(serde_json::to_value(versions)?)
        }

        "quilt.getVersionDetail" => {
            let game_version = req
                .params
                .get("gameVersion")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing gameVersion"))?;
            let loader_version = req
                .params
                .get("loaderVersion")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing loaderVersion"))?;

            let manifest = mojang::get_version_manifest(http, false).await?;
            let vanilla_detail = mojang::get_version_detail(http, &manifest, game_version).await?;
            let merged = quilt::build_quilt_version_detail(http, &vanilla_detail, game_version, loader_version).await?;
            let recommended_java = mojang::recommend_java_major(&vanilla_detail);
            Ok(json!({ "detail": merged, "recommendedJavaMajor": recommended_java }))
        }

        "neoforge.getVersions" => {
            let mc_version = req
                .params
                .get("mcVersion")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing mcVersion"))?;
            let versions = neoforge::get_neo_forge_versions(http, mc_version).await?;
            Ok(serde_json::to_value(versions)?)
        }

        "neoforge.install" => {
            let task_id = req
                .params
                .get("taskId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing taskId"))?
                .to_string();
            let mc_version = req
                .params
                .get("mcVersion")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing mcVersion"))?
                .to_string();
            let full_version = req
                .params
                .get("fullVersion")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing fullVersion"))?
                .to_string();
            let java_path = req
                .params
                .get("javaPath")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing javaPath"))?
                .to_string();
            let libraries_dir = std::path::PathBuf::from(
                req.params
                    .get("librariesDir")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow::anyhow!("missing librariesDir"))?,
            );
            let work_dir = std::path::PathBuf::from(
                req.params
                    .get("workDir")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow::anyhow!("missing workDir"))?,
            );
            let vanilla_client_jar = std::path::PathBuf::from(
                req.params
                    .get("vanillaClientJar")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow::anyhow!("missing vanillaClientJar"))?,
            );
            let vanilla_detail: mojang::VersionDetail = serde_json::from_value(
                req.params
                    .get("vanillaDetail")
                    .cloned()
                    .ok_or_else(|| anyhow::anyhow!("missing vanillaDetail"))?,
            )?;

            let merged = neoforge::install(
                http,
                &task_id,
                &mc_version,
                &full_version,
                &java_path,
                &libraries_dir,
                &work_dir,
                &vanilla_client_jar,
                &vanilla_detail,
            )
            .await?;
            Ok(json!({ "detail": merged }))
        }

        "forge.getVersions" => {
            let mc_version = req
                .params
                .get("mcVersion")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing mcVersion"))?;
            let versions = forge::get_forge_versions(http, mc_version).await?;
            Ok(serde_json::to_value(versions)?)
        }

        "forge.install" => {
            let task_id = req
                .params
                .get("taskId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing taskId"))?
                .to_string();
            let mc_version = req
                .params
                .get("mcVersion")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing mcVersion"))?
                .to_string();
            let full_forge_version = req
                .params
                .get("fullForgeVersion")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing fullForgeVersion"))?
                .to_string();
            let java_path = req
                .params
                .get("javaPath")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing javaPath"))?
                .to_string();
            let libraries_dir = std::path::PathBuf::from(
                req.params
                    .get("librariesDir")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow::anyhow!("missing librariesDir"))?,
            );
            let work_dir = std::path::PathBuf::from(
                req.params
                    .get("workDir")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow::anyhow!("missing workDir"))?,
            );
            let vanilla_client_jar = std::path::PathBuf::from(
                req.params
                    .get("vanillaClientJar")
                    .and_then(|v| v.as_str())
                    .ok_or_else(|| anyhow::anyhow!("missing vanillaClientJar"))?,
            );
            let vanilla_detail: mojang::VersionDetail = serde_json::from_value(
                req.params
                    .get("vanillaDetail")
                    .cloned()
                    .ok_or_else(|| anyhow::anyhow!("missing vanillaDetail"))?,
            )?;

            let merged = forge::install(
                http,
                &task_id,
                &mc_version,
                &full_forge_version,
                &java_path,
                &libraries_dir,
                &work_dir,
                &vanilla_client_jar,
                &vanilla_detail,
                req.params
                    .get("mavenGroupPath")
                    .and_then(|v| v.as_str())
                    .unwrap_or("net/minecraftforge/forge"),
                req.params
                    .get("jarPrefix")
                    .and_then(|v| v.as_str())
                    .unwrap_or("forge"),
                req.params
                    .get("loaderName")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Forge"),
            )
            .await?;
            Ok(json!({ "detail": merged }))
        }

        "java.detectAll" => {
            let installs = java::detect_all();
            Ok(serde_json::to_value(installs)?)
        }

        "java.testPath" => {
            let path = req
                .params
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing path"))?;
            match java::test_java_path(path) {
                Some(install) => Ok(serde_json::to_value(install)?),
                None => Ok(json!(null)),
            }
        }

        "java.ensureRuntime" => {
            let component = req
                .params
                .get("component")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let major_version = req
                .params
                .get("majorVersion")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32)
                .unwrap_or(17);
            let dest_dir = req
                .params
                .get("destDir")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing destDir"))?
                .to_string();
            let task_id = req
                .params
                .get("taskId")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();

            let result = java::ensure_runtime(http, &component, major_version, &dest_dir, &task_id).await?;
            Ok(serde_json::to_value(result)?)
        }

        "downloads.batch" => {
            let task_id = req
                .params
                .get("taskId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing taskId"))?
                .to_string();
            let raw_tasks = req
                .params
                .get("tasks")
                .and_then(|v| v.as_array())
                .ok_or_else(|| anyhow::anyhow!("missing tasks"))?;

            let mut tasks = Vec::with_capacity(raw_tasks.len());
            for t in raw_tasks {
                tasks.push(downloads::DownloadTask {
                    url: t.get("url").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                    dest: std::path::PathBuf::from(t.get("dest").and_then(|v| v.as_str()).unwrap_or_default()),
                    sha1: t.get("sha1").and_then(|v| v.as_str()).map(|s| s.to_string()),
                    size: t.get("size").and_then(|v| v.as_u64()),
                    label: t.get("label").and_then(|v| v.as_str()).unwrap_or_default().to_string(),
                });
            }

            let failed = downloads::download_batch(
                http,
                &task_id,
                tasks,
                req.params
                    .get("maxConcurrency")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as usize)
                    .unwrap_or(8),
                req.params
                    .get("maxAttempts")
                    .and_then(|v| v.as_u64())
                    .map(|v| v as u32)
                    .unwrap_or(3),
                req.params
                    .get("perRequestTimeoutSec")
                    .and_then(|v| v.as_u64())
                    .map(|secs| std::time::Duration::from_secs(secs)),
            )
            .await?;
            Ok(json!({ "failed": failed }))
        }

        "downloads.cancel" => {
            let task_id = req
                .params
                .get("taskId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing taskId"))?
                .to_string();
            // Non-blocking: marks the task cancelled; any in-flight downloads.batch
            // with this task id observes it and aborts (RPC code "cancelled").
            downloads::mark_cancelled(&task_id);
            Ok(json!({ "cancelled": true }))
        }

        "launch.buildArgs" => {
            let detail: mojang::VersionDetail = serde_json::from_value(
                req.params
                    .get("versionDetail")
                    .cloned()
                    .ok_or_else(|| anyhow::anyhow!("missing versionDetail"))?,
            )?;
            let instance: launch::LaunchInstance = serde_json::from_value(
                req.params
                    .get("instance")
                    .cloned()
                    .ok_or_else(|| anyhow::anyhow!("missing instance"))?,
            )?;
            let account: launch::LaunchAccount = serde_json::from_value(
                req.params
                    .get("account")
                    .cloned()
                    .ok_or_else(|| anyhow::anyhow!("missing account"))?,
            )?;
            let args = launch::build_launch_args(&detail, &instance, &account)?;
            Ok(json!({ "args": args }))
        }

        "launch.start" => {
            let instance: launch::LaunchInstance = serde_json::from_value(
                req.params
                    .get("instance")
                    .cloned()
                    .ok_or_else(|| anyhow::anyhow!("missing instance"))?,
            )?;
            let account: launch::LaunchAccount = serde_json::from_value(
                req.params
                    .get("account")
                    .cloned()
                    .ok_or_else(|| anyhow::anyhow!("missing account"))?,
            )?;
            let detail: mojang::VersionDetail = serde_json::from_value(
                req.params
                    .get("versionDetail")
                    .cloned()
                    .ok_or_else(|| anyhow::anyhow!("missing versionDetail"))?,
            )?;

            let args = launch::build_launch_args(&detail, &instance, &account)?;
            let token = account.access_token.clone();
            // Launch is fire-and-forget from the RPC caller's perspective; progress and
            // exit are reported via game.output / game.exit events.
            tokio::spawn(async move {
                if let Err(e) = launch::launch_and_stream(&instance, args, &token).await {
                    tracing::error!("launch failed: {e:#}");
                    // A spawn failure emits no streamed output and never reaches the
                    // exit path, so surface it as an early game.exit so the launcher UI
                    // clears its "launching" state instead of hanging on it forever.
                    write_event(
                        "game.exit",
                        launch::GameExitEvent {
                            instance_id: instance.instance_id.clone(),
                            code: None,
                            crashed: true,
                        },
                    );
                }
            });
            Ok(json!({ "started": true }))
        }

        "launch.running" => {
            let running = launch::running_instances();
            Ok(json!({ "running": running }))
        }

        "launch.stop" => {
            let instance_id = req
                .params
                .get("instanceId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing instanceId"))?;
            let stopped = launch::stop_instance(instance_id).await;
            Ok(json!({ "stopped": stopped }))
        }

        "modpack.extract" => {
            let zip_path = req
                .params
                .get("zipPath")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing zipPath"))?;
            let dest_dir = req
                .params
                .get("destDir")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing destDir"))?;
            let entries = modpack::extract(zip_path, dest_dir).await?;
            Ok(json!({ "entries": entries }))
        }

        "modpack.create" => {
            let zip_path = req
                .params
                .get("zipPath")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing zipPath"))?;
            let index_path = req
                .params
                .get("indexPath")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing indexPath"))?;
            let overrides_dir = req
                .params
                .get("overridesDir")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing overridesDir"))?;
            modpack::create(zip_path, index_path, overrides_dir).await?;
            Ok(json!({ "created": true }))
        }

        "backup.create" => {
            let zip_path = req
                .params
                .get("zipPath")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing zipPath"))?;
            let source_dir = req
                .params
                .get("sourceDir")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing sourceDir"))?;
            modpack::create_directory_archive(zip_path, source_dir).await?;
            Ok(json!({ "created": true }))
        }

        "natives.extract" => {
            let jar_paths: Vec<std::path::PathBuf> = req
                .params
                .get("jarPaths")
                .and_then(|v| v.as_array())
                .ok_or_else(|| anyhow::anyhow!("missing jarPaths"))?
                .iter()
                .filter_map(|v| v.as_str().map(std::path::PathBuf::from))
                .collect();
            let dest_dir = req
                .params
                .get("destDir")
                .and_then(|v| v.as_str())
                .ok_or_else(|| anyhow::anyhow!("missing destDir"))?;
            natives::extract_natives(&jar_paths, std::path::Path::new(dest_dir))?;
            Ok(json!({ "extracted": jar_paths.len() }))
        }

        other => Err(anyhow::anyhow!("unknown method: {other}")),
    }
}
