//! Shared process protocol for headless and window hosts.
use crate::{Handle, Scene, Template, Transaction};
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
struct Request {
    id: u64,
    version: u8,
    #[serde(flatten)]
    command: Command,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Command {
    Install {
        template: Template,
    },
    Apply {
        transaction: Transaction,
    },
    Inspect,
    Redraw,
    Acknowledge {
        handle: Handle,
        site: usize,
        edit: u64,
    },
    #[serde(rename = "event_result")]
    EventResult {
        dispatch: u64,
        prevented: bool,
    },
    Shutdown,
}

pub struct Outcome {
    pub response: Value,
    pub changed: bool,
    pub inspect: bool,
    pub shutdown: bool,
    pub input_ack: Option<(Handle, usize, u64)>,
    pub event_result: Option<(u64, bool)>,
}

pub fn process_line(scene: &mut Scene, line: &str) -> Outcome {
    process_line_with_prepare(scene, line, |_| Ok(()))
}

pub fn process_line_with_prepare(
    scene: &mut Scene,
    line: &str,
    mut prepare: impl FnMut(&crate::template::PreparedTemplate) -> Result<(), String>,
) -> Outcome {
    let mut changed = false;
    let mut inspect = false;
    let mut shutdown = false;
    let mut input_ack = None;
    let mut event_result = None;
    let response = match serde_json::from_str::<Request>(line) {
        Ok(request) => {
            let result = if request.version != 1 {
                Err("Unsupported desktop protocol version".to_owned())
            } else {
                match request.command {
                    Command::Install { template } => scene
                        .install_with(template, &mut prepare)
                        .map(|()| Value::Null),
                    Command::Apply { transaction } => scene.commit(transaction).map(|sequence| {
                        changed = true;
                        json!({"sequence": sequence})
                    }),
                    Command::Inspect => {
                        inspect = true;
                        serde_json::to_value(scene.snapshot()).map_err(|error| error.to_string())
                    }
                    Command::Redraw => {
                        changed = true;
                        Ok(Value::Null)
                    }
                    Command::Acknowledge { handle, site, edit } => {
                        if edit == 0
                            || edit > 9_007_199_254_740_991
                            || !scene.has_change_event(handle, site)
                        {
                            Err("Invalid native input acknowledgment".into())
                        } else {
                            input_ack = Some((handle, site, edit));
                            // Reconciliation belongs to the retained input entity;
                            // acknowledging an edit does not change scene topology.
                            Ok(Value::Null)
                        }
                    }
                    Command::EventResult {
                        dispatch,
                        prevented,
                    } => {
                        if dispatch == 0 || dispatch > 9_007_199_254_740_991 {
                            Err("Invalid event result token".into())
                        } else {
                            event_result = Some((dispatch, prevented));
                            Ok(Value::Null)
                        }
                    }
                    Command::Shutdown => {
                        shutdown = true;
                        Ok(Value::Null)
                    }
                }
            };
            match result {
                Ok(value) => json!({"id": request.id, "result": value}),
                Err(error) => json!({"id": request.id, "error": error}),
            }
        }
        Err(error) => {
            let id = serde_json::from_str::<Value>(line)
                .ok()
                .and_then(|value| value.get("id").and_then(Value::as_u64));
            json!({"id": id, "error": error.to_string()})
        }
    };
    Outcome {
        response,
        changed,
        inspect,
        shutdown,
        input_ack,
        event_result,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejected_protocol_requests_do_not_close_or_dirty_the_scene() {
        let mut scene = Scene::default();
        let outcome = process_line(&mut scene, r#"{"id":1,"version":2,"kind":"shutdown"}"#);
        assert!(!outcome.shutdown && !outcome.changed);
        assert!(outcome.response["error"].is_string());
        let outcome = process_line(
            &mut scene,
            r#"{"id":2,"version":1,"kind":"apply","transaction":{}}"#,
        );
        assert_eq!(outcome.response["id"], 2);
        assert!(!outcome.changed);
    }
}
