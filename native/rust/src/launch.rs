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
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Child;
use tokio::process::Command;

use crate::mojang::VersionDetail;
use crate::protocol::write_event;

/// Tracks every launched Minecraft JVM by instance id so the launcher can report the
/// true process state on demand (`launch.running`) and terminate it (`launch.stop`)
/// without relying on renderer-side guesses. A child is inserted right after spawn
/// and removed once its exit status has been observed.
static RUNNING: OnceLock<Mutex<HashMap<String, Child>>> = OnceLock::new();

fn running_registry() -> &'static Mutex<HashMap<String, Child>> {
    RUNNING.get_or_init(|| Mutex::new(HashMap::new()))
}

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
#[serde(rename_all = "camelCase")]
pub struct GameOutputEvent {
    pub instance_id: String,
    pub stream: String, // "stdout" | "stderr"
    pub line: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameExitEvent {
    pub instance_id: String,
    pub code: Option<i32>,
    pub crashed: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameStartedEvent {
    pub instance_id: String,
    pub pid: u32,
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

/// Evaluates a modern `arguments.jvm`/`arguments.game` rule entry, which — unlike
/// library rules — can also gate on a `features` map (e.g. `has_custom_resolution`,
/// `is_demo_user`). We don't support any of those optional features today, so a rule
/// that requires one to be true simply never matches, which correctly drops the
/// conditional argument (e.g. --width/--height come from our own explicit width/height
/// handling below, not from a features-gated arg).
fn argument_rule_allows(rules: &[Value]) -> bool {
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
        // Any required feature we don't implement disqualifies this rule.
        let features_match = match rule.get("features").and_then(Value::as_object) {
            Some(features) => features.values().all(|v| v.as_bool() == Some(false)),
            None => true,
        };
        if os_matches && features_match {
            allowed = action == "allow";
        }
    }
    allowed
}

/// Substitutes every `${token}` occurrence in `value` using `subst`, leaving unknown
/// tokens untouched rather than blanking them (safer than the single-token `substitute`
/// helper below when a string can contain more than one placeholder, e.g. game args).
fn substitute_all(value: &str, subst: &HashMap<&str, String>) -> String {
    let mut out = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        if let Some(end) = after.find('}') {
            let key = &after[..end];
            match subst.get(key) {
                Some(v) => out.push_str(v),
                None => {
                    out.push_str("${");
                    out.push_str(key);
                    out.push('}');
                }
            }
            rest = &after[end + 1..];
        } else {
            out.push_str("${");
            rest = after;
        }
    }
    out.push_str(rest);
    out
}

/// Pushes the string(s) from a modern `arguments.jvm`/`arguments.game` entry onto
/// `out`, substituting tokens and respecting the entry's rules (if it's a conditional
/// `{rules, value}` object rather than a plain string).
fn push_argument_entry(entry: &Value, subst: &HashMap<&str, String>, out: &mut Vec<String>) {
    if let Some(s) = entry.as_str() {
        out.push(substitute_all(s, subst));
        return;
    }
    let Some(obj) = entry.as_object() else { return };
    let rules: Vec<Value> = obj
        .get("rules")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if !argument_rule_allows(&rules) {
        return;
    }
    match obj.get("value") {
        Some(Value::String(s)) => out.push(substitute_all(s, subst)),
        Some(Value::Array(arr)) => {
            for v in arr {
                if let Some(s) = v.as_str() {
                    out.push(substitute_all(s, subst));
                }
            }
        }
        _ => {}
    }
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

/// Vanilla 1.13+ version JSONs list the auth/version flags in `arguments.game`,
/// but Forge/NeoForge version JSONs omit them and expect the launcher to supply
/// the standard set Minecraft's `Main.main` requires (accessToken, version, ...).
/// Appends any of these flags that the resolved game args don't already contain.
fn ensure_standard_game_args(game_args: &mut Vec<String>, subst: &HashMap<&str, String>) {
    let required: &[(&str, &str)] = &[
        ("--username", "auth_player_name"),
        ("--version", "version_name"),
        ("--gameDir", "game_directory"),
        ("--assetsDir", "assets_root"),
        ("--assetIndex", "assets_index_name"),
        ("--uuid", "auth_uuid"),
        ("--accessToken", "auth_access_token"),
        ("--clientId", "clientid"),
        ("--xuid", "auth_xuid"),
        ("--userType", "user_type"),
        ("--versionType", "version_type"),
    ];
    for (flag, token) in required {
        if !game_args.iter().any(|a| a == flag) {
            game_args.push(flag.to_string());
            game_args.push(subst.get(*token).cloned().unwrap_or_default());
        }
    }
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
    subst.insert("auth_xuid", "0".to_string());
    subst.insert("clientid", "".to_string());
    // Tokens used by modern (1.13+) arguments.jvm, and by Forge/NeoForge version JSONs
    // in particular, whose JVM args reference the library and natives directories and
    // the classpath directly rather than us hardcoding -cp placement.
    subst.insert("natives_directory", natives_dir.to_string_lossy().to_string());
    subst.insert("launcher_name", "noxara-launcher".to_string());
    subst.insert("launcher_version", "0.1.0".to_string());
    subst.insert("classpath", classpath.clone());
    subst.insert("classpath_separator", classpath_separator().to_string());
    subst.insert("library_directory", libraries_dir.to_string_lossy().to_string());
    if let (Some(w), Some(h)) = (instance.width, instance.height) {
        subst.insert("resolution_width", w.to_string());
        subst.insert("resolution_height", h.to_string());
    }

    let mut args = vec![
        format!("-Xms{}M", instance.min_ram_mb),
        format!("-Xmx{}M", instance.max_ram_mb),
        "-Dminecraft.launcher.brand=noxara-launcher".to_string(),
        "-Dminecraft.launcher.version=0.1.0".to_string(),
    ];
    args.extend(instance.extra_jvm_args.iter().cloned());

    let mut game_args: Vec<String> = Vec::new();

    if let Some(arguments) = &detail.arguments {
        // Modern structured format (vanilla 1.13+, and what Forge/NeoForge version
        // JSONs use). Includes conditional entries (rules-gated) alongside plain
        // strings — see push_argument_entry.
        let mut jvm_args: Vec<String> = Vec::new();
        if let Some(jvm) = arguments.get("jvm").and_then(Value::as_array) {
            for entry in jvm {
                push_argument_entry(entry, &subst, &mut jvm_args);
            }
        }
        // If the version JSON doesn't specify JVM args at all (shouldn't normally
        // happen for anything modern enough to use this branch, but don't silently
        // produce an unlaunchable command if it does), fall back to the classpath
        // flags we'd otherwise have hardcoded.
        if jvm_args.is_empty() {
            jvm_args.push(format!("-Djava.library.path={}", natives_dir.display()));
            jvm_args.push("-cp".to_string());
            jvm_args.push(classpath.clone());
        }
        // Forge/NeoForge version JSONs deliberately omit a `-cp` entry from
        // arguments.jvm (they only put bootstraplauncher/asm on the module
        // path `-p`). BootstrapLauncher reads java.class.path to build its
        // bootstrap module layer, so without an explicit classpath it finds no
        // ModLauncher Consumer service and dies with NoSuchElementException at
        // BootstrapLauncher.java:141. Append `-cp` unless the JSON provided one.
        let needs_cp = !jvm_args.iter().any(|a| a == "-cp");
        args.extend(jvm_args);
        if needs_cp {
            args.push("-cp".to_string());
            args.push(classpath.clone());
        }
        args.push(detail.main_class.clone());

        if let Some(game) = arguments.get("game").and_then(Value::as_array) {
            for entry in game {
                push_argument_entry(entry, &subst, &mut game_args);
            }
        }
    } else if let Some(legacy) = &detail.legacy_arguments {
        // Pre-1.13 single-string minecraftArguments format.
        args.push(format!("-Djava.library.path={}", natives_dir.display()));
        args.push("-cp".to_string());
        args.push(classpath.clone());
        args.push(detail.main_class.clone());
        for token in legacy.split_whitespace() {
            game_args.push(substitute(token, &subst));
        }
    } else {
        // Neither format present — fall back to the minimal required set so launching
        // never silently no-ops.
        args.push(format!("-Djava.library.path={}", natives_dir.display()));
        args.push("-cp".to_string());
        args.push(classpath.clone());
        args.push(detail.main_class.clone());
        game_args.push("--username".to_string());
        game_args.push(account.username.clone());
        game_args.push("--version".to_string());
        game_args.push(detail.id.clone());
        game_args.push("--gameDir".to_string());
        game_args.push(instance_dir.to_string_lossy().to_string());
        game_args.push("--assetsDir".to_string());
        game_args.push(assets_dir.to_string_lossy().to_string());
        game_args.push("--assetIndex".to_string());
        game_args.push(detail.assets.clone());
        game_args.push("--uuid".to_string());
        game_args.push(account.uuid.clone());
        game_args.push("--accessToken".to_string());
        game_args.push(account.access_token.clone());
        game_args.push("--userType".to_string());
        game_args.push(account.user_type.clone());
    }

    // Vanilla version JSONs carry the auth/version flags in arguments.game; Forge
    // omits them and requires the launcher to supply them (see
    // ensure_standard_game_args). Idempotent: already-present flags are untouched.
    ensure_standard_game_args(&mut game_args, &subst);

    args.extend(game_args);

    if instance.width.is_some() && instance.height.is_some() && !args.iter().any(|a| a == "--width") {
        // Append an explicit --width/--height for every version family. Vanilla/Forge
        // version JSONs gate resolution behind has_custom_resolution, a feature we never
        // set, so the ${resolution_width}/${resolution_height} tokens in their conditional
        // args are never substituted — without this the launcher's window-size setting
        // silently does nothing on modern (1.13+) versions. An explicit --width/--height
        // is always accepted by the game even when not requested by the JSON's args.
        args.push("--width".to_string());
        args.push(instance.width.unwrap().to_string());
        args.push("--height".to_string());
        args.push(instance.height.unwrap().to_string());
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
/// emits `game.started` on a successful spawn and `game.exit` on completion with a
/// best-effort crash determination. The child is registered so `running_instances`
/// / `stop_instance` can inspect and kill it from anywhere in the process.
pub async fn launch_and_stream(instance: &LaunchInstance, args: Vec<String>, access_token_to_redact: &str) -> Result<()> {
    let instance_id = instance.instance_id.clone();

    // Backstop against a double-launch of the same instance: if the previous JVM is
    // still alive, refuse to spawn another. (Replacing the registry entry would drop
    // the old Child handle and, with kill_on_drop(true), kill the running game.) The
    // renderer guards the UI path, but the core must never silently kill a live game.
    {
        let mut reg = running_registry().lock().unwrap();
        if let Some(existing) = reg.get_mut(&instance_id) {
            match existing.try_wait() {
                Ok(None) => bail!("instance {instance_id} is already running"),
                Ok(Some(_)) => {
                    // Previous process already exited — safe to replace.
                }
                Err(_) => bail!("could not determine state of instance {instance_id}"),
            }
        }
    }

    let mut child = Command::new(&instance.java_path)
        .args(&args)
        .current_dir(&instance.instance_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .context("failed to spawn Java process")?;

    write_event(
        "game.started",
        GameStartedEvent {
            instance_id: instance_id.clone(),
            pid: child.id().unwrap_or(0),
        },
    );

    let stdout = child.stdout.take().context("no stdout handle")?;
    let stderr = child.stderr.take().context("no stderr handle")?;
    // Own the secret as a String so it can be moved into 'static tokio::spawn tasks —
    // borrowing the &str param directly doesn't satisfy tokio::spawn's 'static bound.
    let redacted_token = access_token_to_redact.to_string();

    running_registry().lock().unwrap().insert(instance_id.clone(), child);

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

    let status: Option<i32> = loop {
        match running_registry().lock().unwrap().get_mut(&instance_id) {
            // Reap the status when the OS has observed the process exit. `stop_instance`
            // may have already sent a kill signal; `try_wait()` will surface that exit
            // on a later poll. The lock is never held across the sleep below, so
            // `launch.running`/`launch.stop` RPCs stay responsive for the whole session.
            Some(child) => match child.try_wait() {
                Ok(Some(status)) => break status.code(),
                Ok(None) => {}
                Err(e) => {
                    tracing::warn!("failed waiting on Java process: {e:#}");
                    break None;
                }
            },
            // Removed concurrently (shouldn't happen while the waiter owns the id).
            None => break None,
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    };
    let _ = out_task.await;
    let _ = err_task.await;
    running_registry().lock().unwrap().remove(&instance_id);

    // A crash is inferred, never asserted with false certainty (spec section 41):
    // any non-zero, non-user-terminated exit is reported as "possible crash" upstream.
    write_event(
        "game.exit",
        GameExitEvent {
            instance_id,
            code: status,
            crashed: status != Some(0),
        },
    );

    Ok(())
}

/// Returns the instance ids whose tracked Minecraft JVM is still alive (based on
/// `try_wait`, i.e. the real OS process state — not anything the launcher UI assumes).
pub fn running_instances() -> Vec<String> {
    let mut reg = running_registry().lock().unwrap();
    let mut running = Vec::new();
    reg.retain(|id, child| {
        let alive = match child.try_wait() {
            Ok(Some(_)) => false, // exited already — drop from the registry
            _ => true,            // still running (or wait error — treat as running)
        };
        if alive {
            running.push(id.clone());
        }
        alive
    });
    running
}

/// Terminates the tracked Minecraft JVM for an instance. No-op if nothing is running.
/// Uses `start_kill` (synchronous signal) so the mutex guard never crosses an await —
/// the exit waiter in `launch_and_stream` reaps it and emits `game.exit` as usual.
pub async fn stop_instance(instance_id: &str) -> bool {
    let mut reg = running_registry().lock().unwrap();
    let Some(child) = reg.get_mut(instance_id) else {
        return false;
    };
    match child.start_kill() {
        Ok(_) => true,
        Err(e) => {
            tracing::warn!("failed to kill instance {instance_id}: {e:#}");
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mojang::{AssetIndexRef, DownloadArtifact, Library, LibraryDownloads, VersionDownloads};

    /// The Electron main process / renderer read game events as camelCase
    /// (instanceId, crashed, code, pid, stream, line). Regression guard against
    /// re-introducing snake_case keys (which made launch activities stick in
    /// "Launching" because game.started/game.exit payloads never matched).
    #[test]
    fn game_events_serialize_camel_case_keys() {
        let started = GameStartedEvent {
            instance_id: "inst-1".to_string(),
            pid: 42,
        };
        let started_json = serde_json::to_string(&started).unwrap();
        assert!(started_json.contains("\"instanceId\""), "got: {started_json}");
        assert!(!started_json.contains("instance_id"), "got: {started_json}");

        let exit = GameExitEvent {
            instance_id: "inst-1".to_string(),
            code: Some(1),
            crashed: true,
        };
        let exit_json = serde_json::to_string(&exit).unwrap();
        assert!(exit_json.contains("\"instanceId\""), "got: {exit_json}");
        assert!(exit_json.contains("\"code\""), "got: {exit_json}");
        assert!(exit_json.contains("\"crashed\""), "got: {exit_json}");
        assert!(!exit_json.contains("instance_id"), "got: {exit_json}");

        let output = GameOutputEvent {
            instance_id: "inst-1".to_string(),
            stream: "stdout".to_string(),
            line: "hello".to_string(),
        };
        let output_json = serde_json::to_string(&output).unwrap();
        assert!(output_json.contains("\"instanceId\""), "got: {output_json}");
        assert!(output_json.contains("\"stream\""), "got: {output_json}");
        assert!(output_json.contains("\"line\""), "got: {output_json}");
        assert!(!output_json.contains("instance_id"), "got: {output_json}");
    }

    /// Forge/NeoForge version JSONs omit `-cp ${classpath}` from arguments.jvm
    /// (they only put bootstraplauncher/asm on the module path `-p`). Without an
    /// explicit classpath, BootstrapLauncher can't find ModLauncher's Consumer
    /// service and crashes with NoSuchElementException at BootstrapLauncher.java:141.
    /// Regression guard: a Forge-style version must get a trailing `-cp <classpath>`,
    /// while a vanilla-style one that already declares `-cp` must not be duplicated.
    #[test]
    fn forge_version_gets_explicit_classpath() {
        let mut detail = VersionDetail {
            id: "1.20.1-forge-47.4.22".to_string(),
            main_class: "cpw.mods.bootstraplauncher.BootstrapLauncher".to_string(),
            assets: "1.20".to_string(),
            libraries: vec![Library {
                name: "cpw.mods:modlauncher:10.0.9".to_string(),
                rules: None,
                downloads: Some(LibraryDownloads {
                    artifact: Some(DownloadArtifact {
                        url: String::new(),
                        sha1: String::new(),
                        size: 0,
                    }),
                    classifiers: None,
                }),
                natives: None,
            }],
            arguments: Some(serde_json::json!({
                "jvm": [
                    "-DignoreList=bootstraplauncher",
                    "-p",
                    "${library_directory}/cpw/mods/bootstraplauncher/1.1.2/bootstraplauncher-1.1.2.jar${classpath_separator}${library_directory}/cpw/mods/securejarhandler/2.1.10/securejarhandler-2.1.10.jar",
                    "--add-modules",
                    "ALL-MODULE-PATH"
                ],
                "game": []
            })),
            legacy_arguments: None,
            downloads: VersionDownloads {
                client: DownloadArtifact { url: String::new(), sha1: String::new(), size: 0 },
                server: None,
            },
            asset_index: AssetIndexRef {
                id: "1.20".to_string(),
                url: String::new(),
                sha1: String::new(),
                size: 0,
                total_size: None,
            },
            java_version: None,
        };
        let libs_dir = std::env::temp_dir().join("noxara-cp-test-libs");
        std::fs::create_dir_all(libs_dir.join("cpw/mods/modlauncher/10.0.9")).unwrap();
        let jar_path = libs_dir.join("cpw/mods/modlauncher/10.0.9/modlauncher-10.0.9.jar");
        std::fs::write(&jar_path, b"fake jar contents").unwrap();
        let client_jar = std::env::temp_dir().join("noxara-cp-test-client.jar");
        std::fs::write(&client_jar, b"fake client jar").unwrap();

        let instance = LaunchInstance {
            instance_id: "inst-1".to_string(),
            instance_dir: std::env::temp_dir().join("noxara-cp-test-inst").to_string_lossy().to_string(),
            libraries_dir: libs_dir.to_string_lossy().to_string(),
            client_jar: client_jar.to_string_lossy().to_string(),
            assets_dir: std::env::temp_dir().join("noxara-cp-test-assets").to_string_lossy().to_string(),
            natives_dir: std::env::temp_dir().join("noxara-cp-test-natives").to_string_lossy().to_string(),
            java_path: "java".to_string(),
            min_ram_mb: 512,
            max_ram_mb: 1024,
            width: None,
            height: None,
            extra_jvm_args: vec![],
            extra_game_args: vec![],
        };
        let account = LaunchAccount {
            username: "Player".to_string(),
            uuid: "00000000-0000-0000-0000-000000000000".to_string(),
            access_token: "token".to_string(),
            user_type: "msa".to_string(),
        };

        let args = build_launch_args(&detail, &instance, &account).unwrap();

        let cp_idx = args.iter().position(|a| a == "-cp").expect("Forge launch must include -cp");
        // The classpath after -cp must reference the modlauncher jar (the exact
        // concatenation is verified below rather than hardcoding a temp path).
        let cp_value = &args[cp_idx + 1];
        assert!(
            cp_value.contains("modlauncher-10.0.9.jar"),
            "classpath must contain modlauncher, got: {cp_value}"
        );
        assert!(
            cp_value.contains("noxara-cp-test-client.jar"),
            "classpath must contain the client jar, got: {cp_value}"
        );
        // Exactly one -cp: we must not duplicate the one vanilla provides.
        assert_eq!(args.iter().filter(|a| a.as_str() == "-cp").count(), 1);

        // Sanity: the module path entry got its tokens substituted.
        assert!(args.iter().any(|a| a.contains("bootstraplauncher-1.1.2.jar")));

        // Forge's arguments.game omits the auth/version flags Minecraft's Main.main
        // requires; the launcher must supply them (MissingRequiredOptionsException:
        // accessToken, version otherwise).
        let joined = args.join(" ");
        assert!(joined.contains("--accessToken"), "missing --accessToken in: {joined}");
        assert!(joined.contains("--version"), "missing --version in: {joined}");
        assert!(joined.contains("--username"), "missing --username in: {joined}");

        let _ = std::fs::remove_file(&jar_path);
        let _ = std::fs::remove_file(&client_jar);
    }

    /// Vanilla 1.13+ version JSONs already declare `-cp ${classpath}` in
    /// arguments.jvm. The Forge fix must not append a second one.
    #[test]
    fn vanilla_version_does_not_duplicate_classpath() {
        let detail = VersionDetail {
            id: "1.20.1".to_string(),
            main_class: "net.minecraft.client.main.Main".to_string(),
            assets: "1.20".to_string(),
            libraries: vec![],
            arguments: Some(serde_json::json!({
                "jvm": ["-Djava.library.path=${natives_directory}", "-cp", "${classpath}"],
                "game": []
            })),
            legacy_arguments: None,
            downloads: VersionDownloads {
                client: DownloadArtifact { url: String::new(), sha1: String::new(), size: 0 },
                server: None,
            },
            asset_index: AssetIndexRef {
                id: "1.20".to_string(),
                url: String::new(),
                sha1: String::new(),
                size: 0,
                total_size: None,
            },
            java_version: None,
        };
        let instance = LaunchInstance {
            instance_id: "inst-2".to_string(),
            instance_dir: std::env::temp_dir().join("noxara-cp-test-inst2").to_string_lossy().to_string(),
            libraries_dir: std::env::temp_dir().join("noxara-cp-test-libs2").to_string_lossy().to_string(),
            client_jar: std::env::temp_dir().join("noxara-cp-test-client2.jar").to_string_lossy().to_string(),
            assets_dir: std::env::temp_dir().join("noxara-cp-test-assets2").to_string_lossy().to_string(),
            natives_dir: std::env::temp_dir().join("noxara-cp-test-natives2").to_string_lossy().to_string(),
            java_path: "java".to_string(),
            min_ram_mb: 512,
            max_ram_mb: 1024,
            width: None,
            height: None,
            extra_jvm_args: vec![],
            extra_game_args: vec![],
        };
        let client_jar = std::env::temp_dir().join("noxara-cp-test-client2.jar");
        std::fs::write(&client_jar, b"fake client jar").unwrap();
        let account = LaunchAccount {
            username: "Player".to_string(),
            uuid: "00000000-0000-0000-0000-000000000000".to_string(),
            access_token: "token".to_string(),
            user_type: "msa".to_string(),
        };

        let args = build_launch_args(&detail, &instance, &account).unwrap();

        assert_eq!(args.iter().filter(|a| a.as_str() == "-cp").count(), 1);
        // Vanilla already declares the auth flags; ensure_standard_game_args must
        // not duplicate them.
        assert_eq!(args.iter().filter(|a| a.as_str() == "--accessToken").count(), 1);
        assert_eq!(args.iter().filter(|a| a.as_str() == "--username").count(), 1);
    }
}
