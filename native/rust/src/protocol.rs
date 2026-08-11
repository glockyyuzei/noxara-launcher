//! Line-delimited JSON-RPC-ish protocol between the Electron main process and noxara-core.
//!
//! Requests and responses are newline-delimited JSON objects on stdin/stdout.
//! stderr is reserved for human-readable logs only (never parsed).
//!
//! Request:  { "id": "uuid", "method": "java.detect", "params": { ... } }
//! Response: { "id": "uuid", "ok": true,  "result": { ... } }
//!        or { "id": "uuid", "ok": false, "error": { "code": "...", "message": "..." } }
//! Event:    { "event": "download.progress", "data": { ... } }   (no id, unsolicited, main -> renderer)

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    pub id: String,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize)]
pub struct RpcError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum RpcResponse {
    Ok {
        id: String,
        ok: bool,
        result: Value,
    },
    Err {
        id: String,
        ok: bool,
        error: RpcError,
    },
}

impl RpcResponse {
    pub fn ok(id: &str, result: Value) -> Self {
        RpcResponse::Ok {
            id: id.to_string(),
            ok: true,
            result,
        }
    }

    pub fn err(id: &str, code: &str, message: impl Into<String>) -> Self {
        RpcResponse::Err {
            id: id.to_string(),
            ok: false,
            error: RpcError {
                code: code.to_string(),
                message: message.into(),
            },
        }
    }
}

/// An unsolicited event pushed from core to the main process (e.g. download progress,
/// game log lines). Distinguished from responses by the absence of `id`/`ok`.
#[derive(Debug, Serialize)]
pub struct RpcEvent<T: Serialize> {
    pub event: String,
    pub data: T,
}

pub fn write_response(resp: &RpcResponse) {
    let line = serde_json::to_string(resp).unwrap_or_else(|e| {
        format!(r#"{{"id":"unknown","ok":false,"error":{{"code":"serialize_failed","message":"{e}"}}}}"#)
    });
    println!("{line}");
}

pub fn write_event<T: Serialize>(event: &str, data: T) {
    let evt = RpcEvent {
        event: event.to_string(),
        data,
    };
    if let Ok(line) = serde_json::to_string(&evt) {
        println!("{line}");
    }
}
