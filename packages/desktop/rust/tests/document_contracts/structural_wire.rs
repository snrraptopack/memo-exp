//! Structural packets use the existing staged native transaction contracts.

use super::{body_text, host, text_at};
use std::sync::Arc;
use std::sync::atomic::Ordering;

use blitz_dom::DocumentConfig;
use memoized_dom_desktop::document::{DocumentError, NativeDocument, Owner};
use memoized_dom_desktop::protocol::{ProtocolError, PublicationSession};
use serde_json::{Value, json};

fn packet(sequence: u64, templates: Vec<Value>, operations: Vec<Value>) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "version": 1, "sequence": sequence, "templates": templates, "operations": operations
    }))
    .unwrap()
}

fn owner(id: &str, generation: u64) -> Value {
    json!({"id": id, "generation": generation})
}

fn source(id: &str, generation: u64, index: u32) -> Value {
    json!({"owner": owner(id, generation), "source": index})
}

fn text_template(key: &str, value: &str) -> Value {
    json!({"key": key, "nodes": [{"parent": null, "node": {"kind": "text", "value": value}}]})
}

fn mount(id: &str, generation: u64, template: &str, target: Value) -> Value {
    json!({"op": "mount", "owner": owner(id, generation), "template": template, "target": target})
}

fn write(id: &str, generation: u64, index: u32, value: &str) -> Value {
    json!({"op": "text", "target": source(id, generation, index), "value": value})
}

#[test]
fn wire_declares_once_mounts_from_cached_template_and_reorders_without_new_ids() {
    let (document, _) = host();
    let mut session = PublicationSession::new(document);
    session
        .publish(&packet(
            1,
            vec![text_template("row", "initial")],
            vec![
                mount("a", 1, "row", json!({"kind": "body"})),
                write("a", 1, 0, "A"),
                mount("b", 1, "row", json!({"kind": "body"})),
                write("b", 1, 0, "B"),
            ],
        ))
        .unwrap();
    let a = Owner::new("a", 1);
    let a_id = session.document().node_id(&a.node(0)).unwrap();
    assert_eq!(body_text(session.document()), "AB");
    assert_eq!(session.template_count(), 1);

    session
        .publish(&packet(
            2,
            vec![],
            vec![
                mount("c", 1, "row", json!({"kind": "body"})),
                write("c", 1, 0, "C"),
                json!({"op": "moveBefore", "owner": owner("c", 1), "before": owner("a", 1)}),
                json!({"op": "moveToEnd", "owner": owner("a", 1)}),
                json!({"op": "retire", "owner": owner("b", 1)}),
            ],
        ))
        .unwrap();
    assert_eq!(body_text(session.document()), "CA");
    assert_eq!(session.document().node_id(&a.node(0)).unwrap(), a_id);
    assert_eq!(session.document().owner_count(), 2);
    assert_eq!(session.template_count(), 1);
}

#[test]
fn wire_refusal_publishes_neither_scene_nor_template_declarations() {
    let (document, shell) = host();
    let mut session = PublicationSession::new(document);
    assert_eq!(
        session.publish(&packet(
            1,
            vec![text_template("row", "before")],
            vec![
                mount("a", 1, "row", json!({"kind": "body"})),
                write("a", 1, 99, "bad"),
            ]
        )),
        Err(ProtocolError::Refused(DocumentError::UnknownSource))
    );
    assert_eq!(session.template_count(), 0);
    assert_eq!(session.document().owner_count(), 0);
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
    assert_eq!(
        session.publish(&packet(
            1,
            vec![],
            vec![mount("a", 1, "row", json!({"kind": "body"}))]
        )),
        Err(ProtocolError::UnknownTemplate("row".to_string()))
    );
    session
        .publish(&packet(
            1,
            vec![text_template("row", "corrected")],
            vec![mount("a", 1, "row", json!({"kind": "body"}))],
        ))
        .unwrap();
    assert_eq!(body_text(session.document()), "corrected");
    assert_eq!(session.template_count(), 1);
}

#[test]
fn wire_template_keys_are_immutable_and_duplicate_candidates_refuse() {
    let (document, shell) = host();
    let mut session = PublicationSession::new(document);
    assert_eq!(
        session.publish(&packet(
            1,
            vec![
                text_template("row", "first"),
                text_template("row", "second")
            ],
            vec![]
        )),
        Err(ProtocolError::DuplicateTemplate("row".to_string()))
    );
    assert_eq!(session.template_count(), 0);
    session
        .publish(&packet(1, vec![text_template("row", "accepted")], vec![]))
        .unwrap();
    assert_eq!(session.template_count(), 1);
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
    assert_eq!(
        session.publish(&packet(
            2,
            vec![text_template("row", "replacement")],
            vec![]
        )),
        Err(ProtocolError::DuplicateTemplate("row".to_string()))
    );
    session
        .publish(&packet(
            2,
            vec![],
            vec![mount("a", 1, "row", json!({"kind": "body"}))],
        ))
        .unwrap();
    assert_eq!(body_text(session.document()), "accepted");
}

#[test]
fn wire_new_nested_destinations_and_retirement_use_the_native_topology_validator() {
    let (document, shell) = host();
    let mut session = PublicationSession::new(document);
    let container = json!({"key": "container", "nodes": [
        {"parent": null, "node": {"kind": "element", "name": {"namespace": "http://www.w3.org/1999/xhtml", "local": "div"}, "attributes": []}},
        {"parent": 0, "node": {"kind": "comment", "value": "region:end"}}
    ]});
    let templates = vec![container, text_template("row", "before")];
    let mounts = vec![
        mount("parent", 1, "container", json!({"kind": "body"})),
        mount(
            "child",
            1,
            "row",
            json!({"kind": "region", "source": source("parent", 1, 1)}),
        ),
        write("child", 1, 0, "candidate"),
        json!({"op": "retire", "owner": owner("parent", 1)}),
        write("child", 1, 0, "invalid"),
    ];
    assert_eq!(
        session.publish(&packet(1, templates.clone(), mounts)),
        Err(ProtocolError::Refused(DocumentError::UnknownOwner))
    );
    assert_eq!(session.template_count(), 0);
    assert_eq!(session.document().owner_count(), 0);
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
    session
        .publish(&packet(
            1,
            templates,
            vec![
                mount("parent", 1, "container", json!({"kind": "body"})),
                mount(
                    "child",
                    1,
                    "row",
                    json!({"kind": "element", "source": source("parent", 1, 0)}),
                ),
                write("child", 1, 0, "accepted"),
            ],
        ))
        .unwrap();
    assert_eq!(body_text(session.document()), "accepted");
    session
        .publish(&packet(
            2,
            vec![],
            vec![json!({"op": "retire", "owner": owner("parent", 1)})],
        ))
        .unwrap();
    assert_eq!(session.document().owner_count(), 0);
    assert_eq!(session.template_count(), 2);
}

#[test]
fn wire_template_topology_validation_refuses_before_any_engine_allocation() {
    let (document, shell) = host();
    let mut session = PublicationSession::new(document);
    let mut cyclic = text_template("row", "bad");
    cyclic["nodes"][0]["parent"] = json!(0);
    assert!(matches!(
        session.publish(&packet(1, vec![cyclic], vec![])),
        Err(ProtocolError::Refused(
            DocumentError::InvalidTemplate { .. }
        ))
    ));
    assert_eq!(session.template_count(), 0);
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
    session
        .publish(&packet(1, vec![text_template("row", "valid")], vec![]))
        .unwrap();
}

#[test]
fn wire_strict_structural_fields_and_two_operation_spellings_refuse() {
    let (document, _) = host();
    let mut session = PublicationSession::new(document);
    let mut both: Value = serde_json::from_slice(&packet(1, vec![], vec![])).unwrap();
    both["writes"] = json!([]);
    assert!(matches!(
        session.publish(&serde_json::to_vec(&both).unwrap()),
        Err(ProtocolError::Decode(_))
    ));
    for operation in [
        json!({"op": "retire", "owner": owner("a", 1), "extra": true}),
        mount(
            "a",
            1,
            "row",
            json!({"kind": "body", "source": source("a", 1, 0)}),
        ),
        mount("a", 1, "row", json!({"kind": "unknown"})),
    ] {
        let result = session.publish(&packet(1, vec![], vec![operation]));
        assert!(
            matches!(result, Err(ProtocolError::Decode(_))),
            "unexpected structural decode: {result:?}"
        );
    }
    for id in [owner("a", 0), owner("a", 9_007_199_254_740_992)] {
        assert_eq!(
            session.publish(&packet(
                1,
                vec![],
                vec![json!({"op": "retire", "owner": id})]
            )),
            Err(ProtocolError::InvalidIdentity)
        );
    }
    session.publish(&packet(1, vec![], vec![])).unwrap();
}

#[test]
fn wire_generation_replacement_rejects_stale_writes_without_retiring_the_old_row() {
    let (document, shell) = host();
    let mut session = PublicationSession::new(document);
    session
        .publish(&packet(
            1,
            vec![text_template("row", "old")],
            vec![mount("a", 1, "row", json!({"kind": "body"}))],
        ))
        .unwrap();
    let old = Owner::new("a", 1);
    let old_id = session.document().node_id(&old.node(0)).unwrap();
    shell.redraws.store(0, Ordering::SeqCst);
    assert_eq!(
        session.publish(&packet(
            2,
            vec![],
            vec![
                json!({"op": "retire", "owner": owner("a", 1)}),
                mount("a", 2, "row", json!({"kind": "body"})),
                write("a", 1, 0, "stale"),
            ]
        )),
        Err(ProtocolError::Refused(DocumentError::UnknownOwner))
    );
    assert_eq!(session.document().node_id(&old.node(0)).unwrap(), old_id);
    assert_eq!(text_at(session.document(), &old, 0), "old");
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
    session
        .publish(&packet(
            2,
            vec![],
            vec![
                json!({"op": "retire", "owner": owner("a", 1)}),
                mount("a", 2, "row", json!({"kind": "body"})),
                write("a", 2, 0, "new"),
            ],
        ))
        .unwrap();
    assert_eq!(body_text(session.document()), "new");
    assert!(session.document().engine().get_node(old_id).is_none());
}

#[test]
fn actual_structural_application_failure_closes_wire_session_and_rejects_retry() {
    let shell = Arc::new(super::transaction::FailingShell::default());
    let document = NativeDocument::new(DocumentConfig {
        shell_provider: Some(shell.clone()),
        ..DocumentConfig::default()
    });
    let mut session = PublicationSession::new(document);
    shell.countdown.store(1, Ordering::SeqCst);
    let bytes = packet(
        1,
        vec![text_template("row", "partially applied")],
        vec![mount("a", 1, "row", json!({"kind": "body"}))],
    );
    assert_eq!(
        session.publish(&bytes),
        Err(ProtocolError::AcceptanceUnknown)
    );
    assert!(session.is_closed());
    assert!(session.document().is_failed());
    assert_eq!(body_text(session.document()), "partially applied");
    assert_eq!(session.template_count(), 0);
    assert_eq!(session.publish(&bytes), Err(ProtocolError::Closed));
}
