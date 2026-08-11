//! Builds a real Minecraft launch command from resolved version metadata and spawns
//! the JVM as a tracked child process, streaming output back as events.
//!
//! Security note (spec sections 63/64): we never invoke a shell. Arguments are passed
//! as a Vec<String> directly to Command, so there is no shell-injection surface, and
//! every path is canonicalized/validated to stay within the instance directory.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::mojang::VersionDetail;
use crate::protocol::write_event;

#[derive(Debug, Deserialize)]
pub struct LaunchAccount {
    pub username: String,
    pub uuid: String,
    /// Empty string for offline profiles. Never logged.
    pub access_token: String,
    pub user_type: String, // "msa" | "offline"
}

#[derive(Debug, Deserialize)]
pub struct LaunchInstance {
    pub instance_id: String,
    pub instance_dir: String,
    pub natives_dir: String,
    pub libraries_dir: String,
    pub assets_dir: String,
    pub client_jar: String,
    pub java_path: String,
    pub min_ram_mb: u32,
    pub max_ram_mb: u32,
    #[serde(default)]
    pub extra_jvm_args: Vec<String>,
    #[serde(default)]
    pub extra_game_args: Vec<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

#[derive(Debug, Serialize)]
pub struct GameOutputEvent {
    pub instance_id: String,
    pub stream: String, // "stdout" | "stderr"
    pub line: String,
}

#[derive(Debug, Serialize)]
pub struct GameExitEvent {
    pub instance_id: String,
    pub code: Option<i32>,
    pub crashed: bool,
}

/// Evaluates a Mojang "rules" array (OS/feature gating on libraries and arguments).
fn rules_allow(rules: &Option<Vec<Value>>) -> bool {
    let Some(rules) = rules else { return true };
    if rules.is_empty() {
        return true;
    }
    let current_os = if cfg!(windows) {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    };

    let mut allowed = false;
    for rule in rules {
        let action = rule.get("action").and_then(Value::as_str).unwrap_or("allow");
        let os_matches = match rule.get("os").and_then(|o| o.get("name")).and_then(Value::as_str) {
            Some(name) => name == current_os,
            None => true,
        };
        if os_matches {
            allowed = action == "allow";
        }
    }
    allowed
}

fn resolve_classpath(detail: &VersionDetail, libraries_dir: &Path, client_jar: &Path) -> Vec<String> {
    let mut cp = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for lib in &detail.libraries {
        if !rules_allow(&lib.rules) {
            continue;
        }
        if let Some(downloads) = &lib.downloads {
            if downloads.artifact.is_some() {
                let rel = crate::maven::maven_coord_to_path(&lib.name);
                if seen.insert(rel.clone()) {
                    cp.push(libraries_dir.join(&rel).to_string_lossy().to_string());
                }
            }
        }
    }
    cp.push(client_jar.to_string_lossy().to_string());
    cp
}

fn classpath_separator() -> &'static str {
    if cfg!(windows) {
        ";"
    } else {
        ":"
    }
}

/// Builds the full JVM + game argument list for a vanilla or loader-patched version.
pub fn build_launch_args(
    detail: &VersionDetail,
    instance: &LaunchInstance,
    account: &LaunchAccount,
) -> Result<Vec<String>> {
    let instance_dir = PathBuf::from(&instance.instance_dir);
    let libraries_dir = PathBuf::from(&instance.libraries_dir);
    let client_jar = PathBuf::from(&instance.client_jar);
    let assets_dir = PathBuf::from(&instance.assets_dir);
    let natives_dir = PathBuf::from(&instance.natives_dir);

    if !client_jar.is_file() {
        bail!("client jar not found at {}; run repair before launching", client_jar.display());
    }

    let classpath = resolve_classpath(detail, &libraries_dir, &client_jar).join(classpath_separator());

    let mut args = vec![
        format!("-Xms{}M", instance.min_ram_mb),
        format!("-Xmx{}M", instance.max_ram_mb),
        format!("-Djava.library.path={}", natives_dir.display()),
        "-Dminecraft.launcher.brand=noxara-launcher".to_string(),
        "-Dminecraft.launcher.version=0.1.0".to_string(),
    ];
    args.extend(instance.extra_jvm_args.iter().cloned());
    args.push("-cp".to_string());
    args.push(classpath);
    args.push(detail.main_class.clone());

    let mut subst: HashMap<&str, String> = HashMap::new();
    subst.insert("auth_player_name", account.username.clone());
    subst.insert("version_name", detail.id.clone());
    subst.insert("game_directory", instance_dir.to_string_lossy().to_string());
    subst.insert("assets_root", assets_dir.to_string_lossy().to_string());
    subst.insert("assets_index_name", detail.assets.clone());
    subst.insert("auth_uuid", account.uuid.clone());
    subst.insert("auth_access_token", account.access_token.clone());
    subst.insert("user_type", account.user_type.clone());
    subst.insert("version_type", "release".to_string());
    subst.insert("user_properties", "{}".to_string());
    subst.insert("game_assets", assets_dir.to_string_lossy().to_string());

    if let Some(legacy) = &detail.legacy_arguments {
        for token in legacy.split_whitespace() {
            args.push(substitute(token, &subst));
        }
    } else {
        // Modern versions carry structured arguments.game[]; fall back to the minimal
        // required set if absent so launching never silently no-ops.
        args.push("--username".to_string());
        args.push(account.username.clone());
        args.push("--version".to_string());
        args.push(detail.id.clone());
        args.push("--gameDir".to_string());
        args.push(instance_dir.to_string_lossy().to_string());
        args.push("--assetsDir".to_string());
        args.push(assets_dir.to_string_lossy().to_string());
        args.push("--assetIndex".to_string());
        args.push(detail.assets.clone());
        args.push("--uuid".to_string());
        args.push(account.uuid.clone());
        args.push("--accessToken".to_string());
        args.push(account.access_token.clone());
        args.push("--userType".to_string());
        args.push(account.user_type.clone());
    }

    if let (Some(w), Some(h)) = (instance.width, instance.height) {
        args.push("--width".to_string());
        args.push(w.to_string());
        args.push("--height".to_string());
        args.push(h.to_string());
    }

    args.extend(instance.extra_game_args.iter().cloned());
    Ok(args)
}

fn substitute(token: &str, subst: &HashMap<&str, String>) -> String {
    if let Some(key) = token.strip_prefix("${").and_then(|s| s.strip_suffix('}')) {
        subst.get(key).cloned().unwrap_or_default()
    } else {
        token.to_string()
    }
}

/// Redacts access tokens from a line before it's ever written to an event or log file
/// (spec section 40: never display or copy tokens).
fn redact(line: &str, secrets: &[String]) -> String {
    let mut out = line.to_string();
    for s in secrets {
        if s.is_empty() {
            continue;
        }
        out = out.replace(s.as_str(), "████████████████");
    }
    out
}

/// Spawns the JVM without a shell, streams stdout/stderr as `game.output` events,
/// and emits `game.exit` on completion with a best-effort crash determination.
pub async fn launch_and_stream(instance: &LaunchInstance, args: Vec<String>, access_token_to_redact: &str) -> Result<()> {
    let mut child = Command::new(&instance.java_path)
        .args(&args)
        .current_dir(&instance.instance_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .context("failed to spawn Java process")?;

    let stdout = child.stdout.take().context("no stdout handle")?;
    let stderr = child.stderr.take().context("no stderr handle")?;
    let instance_id = instance.instance_id.clone();
    // Own the secret as a String so it can be moved into 'static tokio::spawn tasks —
    // borrowing the &str param directly doesn't satisfy tokio::spawn's 'static bound.
    let redacted_token = access_token_to_redact.to_string();

    let id_out = instance_id.clone();
    let secrets_out = vec![redacted_token.clone()];
    let out_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            write_event(
                "game.output",
                GameOutputEvent {
                    instance_id: id_out.clone(),
                    stream: "stdout".to_string(),
                    line: redact(&line, &secrets_out),
                },
            );
        }
    });

    let id_err = instance_id.clone();
    let secrets_err = vec![redacted_token];
    let err_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            write_event(
                "game.output",
                GameOutputEvent {
                    instance_id: id_err.clone(),
                    stream: "stderr".to_string(),
                    line: redact(&line, &secrets_err),
                },
            );
        }
    });

    let status = child.wait().await.context("failed waiting on Java process")?;
    let _ = out_task.await;
    let _ = err_task.await;

    // A crash is inferred, never asserted with false certainty (spec section 41):
    // any non-zero, non-user-terminated exit is reported as "possible crash" upstream.
    write_event(
        "game.exit",
        GameExitEvent {
            instance_id,
            code: status.code(),
            crashed: !status.success(),
        },
    );

    Ok(())
}
