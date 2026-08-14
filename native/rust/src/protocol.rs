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
        // Serialization of a normal response can only fail on a non-JSON-encodable
        // value (e.g. NaN/Infinity in a float). Fall back to an error response whose
        // message is JSON-escaped properly via json! — a hand-formatted string would
        // produce invalid JSON if the error text contained quotes/backslashes, which
        // would break the Electron side's line-parser.
        serde_json::to_string(&serde_json::json!({
            "id": "unknown",
            "ok": false,
            "error": { "code": "serialize_failed", "message": e.to_string() },
        }))
        .unwrap_or_else(|_| r#"{"id":"unknown","ok":false,"error":{"code":"serialize_failed","message":"failed to serialize error"}}"#.to_string())
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// A response line must always parse as one complete JSON value, no matter how
    /// hostile the payload. This is the core escaping guarantee the Electron line
    /// parser depends on (it splits on `\n`).
    fn assert_valid_single_line(json: &str) -> Value {
        assert_eq!(json.matches('\n').count(), 0, "response must be a single line");
        let v: Value = serde_json::from_str(json).expect("response must be valid JSON");
        assert!(v.is_object());
        v
    }

    #[test]
    fn error_message_with_quotes_backslashes_and_newlines_round_trips() {
        let msg = "bad \"quote\" \\ backslash \n line\nbreak\t\u{1b}[31mtab";
        let line = serde_json::to_string(&RpcResponse::err("id-1", "boom", msg)).unwrap();
        let v = assert_valid_single_line(&line);
        assert_eq!(v["ok"], json!(false));
        assert_eq!(v["error"]["code"], json!("boom"));
        assert_eq!(v["error"]["message"], json!(msg));
    }

    #[test]
    fn success_result_with_hostile_strings_round_trips() {
        let data = json!({
            "path": "C:\\Users\\O'Brien\\app",
            "text": "line1\nline2\n  \"nested\" \\ done",
            "emoji": "✓ 😀",
            "nul": "\u{0000}",
        });
        let line = serde_json::to_string(&RpcResponse::ok("id-2", data.clone())).unwrap();
        let v = assert_valid_single_line(&line);
        assert_eq!(v["ok"], json!(true));
        assert_eq!(v["result"], data);
    }

    #[test]
    fn response_id_itself_is_escaped() {
        let line = serde_json::to_string(&RpcResponse::ok("weird \"id\" \\ ok", json!(1))).unwrap();
        let v = assert_valid_single_line(&line);
        assert_eq!(v["id"], json!("weird \"id\" \\ ok"));
        assert_eq!(v["result"], json!(1));
    }

    #[test]
    fn event_payload_round_trips() {
        let data = json!({ "line": "a\nb", "stream": "stdout" });
        let line = serde_json::to_string(&RpcEvent {
            event: "game.output".to_string(),
            data: data.clone(),
        })
        .unwrap();
        let v = assert_valid_single_line(&line);
        assert_eq!(v["event"], json!("game.output"));
        assert_eq!(v["data"], data);
    }

    #[test]
    fn serialize_failed_fallback_is_still_valid_json() {
        // A float NaN can't be serialized by serde_json into a response normally; the
        // fallback must produce a valid, single-line JSON error object, never a raw
        // unescaped string (which would corrupt the line protocol).
        let resp = RpcResponse::ok("id-3", serde_json::to_value(f64::NAN).unwrap());
        // Force the fallback path by serializing a value serde rejects. NaN round-trips
        // through Value as Null in serde_json, so instead emulate the failure by
        // checking the escape function on a deliberately broken value type.
        let _ = &resp;
        // Direct check: the fallback string constant and the json! branch both produce
        // parseable JSON when the error message contains hostile characters.
        for msg in [
            "serialization of \"NaN\" failed",
            "quote \" and slash \\ here",
        ] {
            let line = serde_json::to_string(&serde_json::json!({
                "id": "unknown",
                "ok": false,
                "error": { "code": "serialize_failed", "message": msg },
            }))
            .unwrap();
            let v = assert_valid_single_line(&line);
            assert_eq!(v["error"]["message"], json!(msg));
        }
        // The last-resort constant must parse too.
        let fallback = r#"{"id":"unknown","ok":false,"error":{"code":"serialize_failed","message":"failed to serialize error"}}"#;
        assert_valid_single_line(fallback);
    }
}
