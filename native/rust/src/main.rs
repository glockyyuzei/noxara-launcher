mod downloads;
mod fabric;
mod forge;
mod java;
mod launch;
mod maven;
mod mojang;
mod natives;
mod protocol;

use protocol::{write_response, RpcRequest, RpcResponse};
use serde_json::json;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};

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
        Err(e) => write_response(&RpcResponse::err(&id, "internal_error", format!("{e:#}"))),
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

            let failed = downloads::download_batch(http, &task_id, tasks, 8).await?;
            Ok(json!({ "failed": failed }))
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
                }
            });
            Ok(json!({ "started": true }))
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
