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
    Measure {
        handle: Handle,
        node: usize,
    },
    Focus {
        handle: Handle,
        node: usize,
        focused: bool,
        #[serde(default)]
        prevent_scroll: bool,
    },
    Redraw,
    Frame,
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
    pub focus: Option<FocusRequest>,
    pub response: Value,
    pub changed: bool,
    pub inspect: bool,
    pub shutdown: bool,
    pub input_ack: Option<(Handle, usize, u64)>,
    pub event_result: Option<(u64, bool)>,
    pub frame: bool,
    pub measure: Option<(Handle, usize)>,
}

#[derive(Clone, Copy)]
pub struct FocusRequest {
    pub handle: Handle,
    pub node: usize,
    pub focused: bool,
    pub prevent_scroll: bool,
}

pub fn process_line(scene: &mut Scene, line: &str) -> Outcome {
    process_line_with_prepare(scene, line, |_| Ok(()))
}

pub fn process_line_with_prepare(
    scene: &mut Scene,
    line: &str,
    mut prepare: impl FnMut(&crate::template::PreparedTemplate) -> Result<(), String>,
) -> Outcome {
    let mut outcome = process_line_with_validation(scene, line, |candidate| match candidate {
        Preparation::Template(template) => prepare(template),
        Preparation::Instances { .. } => Ok(()),
    });
    // The headless adapter owns semantic state but has no laid-out geometry.
    if outcome.measure.take().is_some() {
        outcome.response = json!({
            "id": outcome.response["id"],
            "error": "Element measurement requires a native window host"
        });
    }
    if outcome.focus.take().is_some() {
        outcome.response = json!({
            "id": outcome.response["id"],
            "error": "Element focus requires a native window host"
        });
    }
    outcome
}

pub enum Preparation<'a> {
    Template(&'a crate::template::PreparedTemplate),
    Instances {
        instances: &'a [&'a crate::Instance],
        flow: &'a crate::flow::SceneFlow,
    },
}

/// Use one callback so install and commit validation can share adapter caches.
pub fn process_line_with_validation(
    scene: &mut Scene,
    line: &str,
    mut prepare: impl FnMut(Preparation<'_>) -> Result<(), String>,
) -> Outcome {
    let mut changed = false;
    let mut inspect = false;
    let mut shutdown = false;
    let mut input_ack = None;
    let mut event_result = None;
    let mut frame = false;
    let mut measure = None;
    let mut focus = None;
    let response = match serde_json::from_str::<Request>(line) {
        Ok(request) => {
            let result = if request.version != 1 {
                Err("Unsupported desktop protocol version".to_owned())
            } else {
                match request.command {
                    Command::Install { template } => scene
                        .install_with(template, |template| {
                            prepare(Preparation::Template(template))
                        })
                        .map(|()| Value::Null),
                    Command::Apply { transaction } => scene
                        .commit_with_flow(transaction, |instances, flow| {
                            prepare(Preparation::Instances { instances, flow })
                        })
                        .map(|sequence| {
                            changed = true;
                            json!({"sequence": sequence})
                        }),
                    Command::Inspect => {
                        inspect = true;
                        serde_json::to_value(scene.snapshot()).map_err(|error| error.to_string())
                    }
                    Command::Measure { handle, node } => {
                        if !scene.has_element(handle, node) {
                            Err("Measurement requires a live element source".into())
                        } else {
                            measure = Some((handle, node));
                            Ok(Value::Null)
                        }
                    }
                    Command::Focus {
                        handle,
                        node,
                        focused,
                        prevent_scroll,
                    } => {
                        if !scene.has_element(handle, node) {
                            Err("Focus requires a live element source".into())
                        } else {
                            focus = Some(FocusRequest {
                                handle,
                                node,
                                focused,
                                prevent_scroll,
                            });
                            Ok(Value::Null)
                        }
                    }
                    Command::Redraw => {
                        changed = true;
                        Ok(Value::Null)
                    }
                    Command::Frame => {
                        frame = true;
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
        focus,
        response,
        changed,
        inspect,
        shutdown,
        input_ack,
        event_result,
        frame,
        measure,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn focus_commands_require_live_controls_and_refuse_headless_execution() {
        let mut scene = Scene::default();
        scene
            .install(
                serde_json::from_value(json!({
                    "id":"controls", "nodes":[
                        {"kind":"element","tag":"main","parent":null,"text":""},
                        {"kind":"element","tag":"button","parent":0,"text":""},
                        {"kind":"element","tag":"input","parent":0,"text":""},
                        {"kind":"text","parent":1,"text":"Button"}
                    ], "slots":[], "events":[]
                }))
                .unwrap(),
            )
            .unwrap();
        scene
            .commit(
                serde_json::from_value(json!({
                    "sequence":1,"operations":[{
                        "kind":"mount","handle":{"id":1,"generation":1},
                        "template":"controls","values":[]
                    }]
                }))
                .unwrap(),
            )
            .unwrap();
        let request = |generation, node, focused| {
            json!({
                "id":5,"version":1,"kind":"focus",
                "handle":{"id":1,"generation":generation},"node":node,"focused":focused
            })
            .to_string()
        };
        for node in [1, 2] {
            for focused in [true, false] {
                let outcome = process_line_with_validation(
                    &mut scene,
                    &request(1, node, focused),
                    |_| Ok(()),
                );
                let command = outcome.focus.unwrap();
                assert_eq!(command.focused, focused);
                assert!(!command.prevent_scroll);
                assert!(!outcome.changed);
                let outcome = process_line(&mut scene, &request(1, node, focused));
                assert!(
                    outcome.response["error"]
                        .as_str()
                        .unwrap()
                        .contains("window host")
                );
            }
        }
        assert!(!scene.has_focus_control(
            Handle {
                id: 1,
                generation: 1
            },
            0
        ));
        for (generation, node) in [(2, 1), (1, 3), (1, 99)] {
            let outcome =
                process_line_with_validation(&mut scene, &request(generation, node, true), |_| {
                    Ok(())
                });
            assert!(outcome.focus.is_none());
            assert!(outcome.response["error"].is_string());
        }
        assert_eq!(scene.sequence(), 1);
        let mut prevented: Value = serde_json::from_str(&request(1, 1, true)).unwrap();
        prevented["prevent_scroll"] = json!(true);
        let outcome = process_line_with_validation(&mut scene, &prevented.to_string(), |_| Ok(()));
        assert!(outcome.focus.unwrap().prevent_scroll);
    }
    #[test]
    fn measurement_validates_sources_and_requires_a_window_adapter() {
        let mut scene = Scene::default();
        scene
            .install(
                serde_json::from_value(json!({
                    "id":"measured", "nodes":[
                        {"kind":"element","tag":"p","parent":null,"text":""},
                        {"kind":"text","parent":0,"text":"hello"}
                    ], "slots":[], "events":[]
                }))
                .unwrap(),
            )
            .unwrap();
        scene
            .commit(
                serde_json::from_value(json!({
                    "sequence":1, "operations":[{
                        "kind":"mount","handle":{"id":1,"generation":1},
                        "template":"measured","values":[]
                    }]
                }))
                .unwrap(),
            )
            .unwrap();
        let request = |generation, node| {
            json!({
                "id":9,"version":1,"kind":"measure",
                "handle":{"id":1,"generation":generation},"node":node
            })
            .to_string()
        };
        let valid = process_line_with_validation(&mut scene, &request(1, 0), |_| Ok(()));
        assert_eq!(
            valid.measure,
            Some((
                Handle {
                    id: 1,
                    generation: 1
                },
                0
            ))
        );
        assert!(!valid.changed);
        for (generation, node) in [(2, 0), (1, 1), (1, 99)] {
            let rejected =
                process_line_with_validation(&mut scene, &request(generation, node), |_| Ok(()));
            assert!(rejected.measure.is_none());
            assert!(rejected.response["error"].is_string());
        }
        let headless = process_line(&mut scene, &request(1, 0));
        assert!(headless.measure.is_none());
        assert!(
            headless.response["error"]
                .as_str()
                .unwrap()
                .contains("window host")
        );
        assert_eq!(scene.sequence(), 1);
    }
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
