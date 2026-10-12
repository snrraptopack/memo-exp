//! Wire contracts share the real native fixture and one integration executable.

use super::{RecordingShell, element, host, template, text, text_at};
use blitz_dom::{NodeData, QualName, local_name, ns};
use memoized_dom_desktop::document::{DocumentError, MountTarget, Owner};
use memoized_dom_desktop::protocol::{
    MAX_PACKET_BYTES, MAX_WRITES, ProtocolError, PublicationSession,
};
use serde_json::{Value, json};
use std::sync::Arc;
use std::sync::atomic::Ordering;

fn publication_host() -> (PublicationSession, Arc<RecordingShell>, Owner) {
    let (mut document, shell) = host();
    let owner = Owner::new("App", 1);
    let source = template(vec![element("div", vec![], None), text("before", Some(0))]);
    document
        .mount(owner.clone(), &source, MountTarget::Body)
        .unwrap();
    shell.redraws.store(0, Ordering::SeqCst);
    (PublicationSession::new(document), shell, owner)
}

fn wire_target(owner: &Owner, source: u32) -> Value {
    json!({"owner": {"id": owner.id, "generation": owner.generation}, "source": source})
}

fn text_write(owner: &Owner, source: u32, value: &str) -> Value {
    json!({"op": "text", "target": wire_target(owner, source), "value": value})
}

fn packet(sequence: u64, writes: Vec<Value>) -> Vec<u8> {
    serde_json::to_vec(&json!({"version": 1, "sequence": sequence, "writes": writes})).unwrap()
}

#[test]
fn wire_acceptance_follows_complete_native_application_and_preserves_ids() {
    let (mut session, shell, owner) = publication_host();
    let node = session.document().node_id(&owner.node(1)).unwrap();
    let accepted = session
        .publish(&packet(
            1,
            vec![
                text_write(&owner, 1, "first"),
                text_write(&owner, 1, "last"),
                json!({
                    "op": "setAttribute", "target": wire_target(&owner, 0),
                    "name": {"namespace": "", "local": "class"}, "value": "active"
                }),
            ],
        ))
        .unwrap();

    assert_eq!(accepted.sequence(), 1);
    assert_eq!(
        serde_json::to_value(accepted).unwrap(),
        json!({"version": 1, "sequence": 1, "status": "accepted"})
    );
    assert_eq!(text_at(session.document(), &owner, 1), "last");
    assert_eq!(session.document().node_id(&owner.node(1)).unwrap(), node);
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 1);
    let element = session
        .document()
        .engine()
        .get_node(session.document().node_id(&owner.node(0)).unwrap())
        .unwrap();
    assert_eq!(element.data.attr(local_name!("class")), Some("active"));

    session
        .publish(&packet(
            2,
            vec![json!({
                "op": "removeAttribute", "target": wire_target(&owner, 0),
                "name": {"namespace": "", "local": "class"}
            })],
        ))
        .unwrap();
    let element = session
        .document()
        .engine()
        .get_node(session.document().node_id(&owner.node(0)).unwrap())
        .unwrap();
    assert_eq!(element.data.attr(local_name!("class")), None);
}

#[test]
fn wire_duplicates_and_gaps_cannot_reapply_or_advance_the_scene() {
    let (mut session, shell, owner) = publication_host();
    assert_eq!(
        session.publish(&packet(2, vec![text_write(&owner, 1, "gap")])),
        Err(ProtocolError::OutOfOrder {
            expected: 1,
            received: 2
        })
    );
    assert_eq!(text_at(session.document(), &owner, 1), "before");
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);

    session
        .publish(&packet(1, vec![text_write(&owner, 1, "accepted")]))
        .unwrap();
    shell.redraws.store(0, Ordering::SeqCst);
    for sequence in [1, 3] {
        assert_eq!(
            session.publish(&packet(sequence, vec![text_write(&owner, 1, "bad")])),
            Err(ProtocolError::OutOfOrder {
                expected: 2,
                received: sequence
            })
        );
    }
    assert_eq!(text_at(session.document(), &owner, 1), "accepted");
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
    assert_eq!(session.publish(&packet(2, vec![])).unwrap().sequence(), 2);
    // An empty accepted publication advances ordering without requesting redraw.
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
}

#[test]
fn wire_late_bad_reference_refuses_all_writes_and_allows_corrected_sequence() {
    let (mut session, shell, owner) = publication_host();
    let writes = vec![
        text_write(&owner, 1, "candidate"),
        text_write(&owner, 99, "bad"),
    ];
    assert_eq!(
        session.publish(&packet(1, writes)),
        Err(ProtocolError::Refused(DocumentError::UnknownSource))
    );
    assert_eq!(text_at(session.document(), &owner, 1), "before");
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
    assert!(!session.is_closed());
    session
        .publish(&packet(1, vec![text_write(&owner, 1, "corrected")]))
        .unwrap();
    assert_eq!(text_at(session.document(), &owner, 1), "corrected");
}

#[test]
fn wire_wrong_kind_invalid_attribute_and_stale_generation_refuse_without_effects() {
    let (mut session, shell, owner) = publication_host();
    let cases = [
        (
            text_write(&owner, 0, "not text"),
            DocumentError::WrongNodeKind,
        ),
        (
            text_write(&Owner::new("App", 2), 1, "stale"),
            DocumentError::UnknownOwner,
        ),
        (
            json!({
                "op": "setAttribute", "target": wire_target(&owner, 0),
                "name": {"namespace": "", "local": "bad attr"}, "value": "bad"
            }),
            DocumentError::InvalidTemplate {
                source: Some(0),
                reason: "attribute name is invalid",
            },
        ),
    ];
    for (write, reason) in cases {
        assert_eq!(
            session.publish(&packet(1, vec![text_write(&owner, 1, "candidate"), write])),
            Err(ProtocolError::Refused(reason))
        );
        assert_eq!(text_at(session.document(), &owner, 1), "before");
        assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
    }
}

#[test]
fn wire_strict_schema_refuses_missing_unknown_duplicate_and_mistyped_fields() {
    let (mut session, shell, owner) = publication_host();
    let valid = json!({"version": 1, "sequence": 1, "writes": [text_write(&owner, 1, "bad")]});
    let mut variants = Vec::new();
    let mut extra = valid.clone();
    extra["ignored"] = json!(true);
    variants.push(extra);
    for path in ["writes", "sequence", "version"] {
        let mut missing = valid.clone();
        missing.as_object_mut().unwrap().remove(path);
        variants.push(missing);
    }
    for key in ["value", "target", "op"] {
        let mut missing = valid.clone();
        missing["writes"][0].as_object_mut().unwrap().remove(key);
        variants.push(missing);
    }
    for value in [json!(null), json!(7), json!(true)] {
        let mut wrong = valid.clone();
        wrong["writes"][0]["value"] = value;
        variants.push(wrong);
    }
    for path in [vec!["target"], vec!["target", "owner"]] {
        let mut unknown = valid.clone();
        let mut record = &mut unknown["writes"][0];
        for field in path {
            record = &mut record[field];
        }
        record["extra"] = json!(true);
        variants.push(unknown);
    }
    let mut unsupported = valid.clone();
    unsupported["writes"][0]["op"] = json!("mount");
    variants.push(unsupported);
    let mut fractional = valid.clone();
    fractional["sequence"] = json!(1.5);
    variants.push(fractional);
    let mut negative = valid.clone();
    negative["writes"][0]["target"]["source"] = json!(-1);
    variants.push(negative);

    for value in variants {
        assert!(matches!(
            session.publish(&serde_json::to_vec(&value).unwrap()),
            Err(ProtocolError::Decode(_))
        ));
    }
    for bytes in [
        br#"{"version":1,"version":1,"sequence":1,"writes":[]}"#.as_slice(),
        br#"{"version":1,"sequence":1,"writes":[]} {}"#.as_slice(),
        b"\xff".as_slice(),
    ] {
        assert!(matches!(
            session.publish(bytes),
            Err(ProtocolError::Decode(_))
        ));
    }
    assert_eq!(text_at(session.document(), &owner, 1), "before");
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
    session.publish(&packet(1, vec![])).unwrap();
}

#[test]
fn wire_version_and_integer_limits_refuse_without_consuming_the_sequence() {
    let (mut session, _, owner) = publication_host();
    let version = br#"{"version":2,"sequence":1,"writes":[]}"#;
    assert_eq!(
        session.publish(version),
        Err(ProtocolError::UnsupportedVersion { received: 2 })
    );
    for sequence in [0, 9_007_199_254_740_992, u64::MAX] {
        assert_eq!(
            session.publish(&packet(sequence, vec![])),
            Err(ProtocolError::InvalidSequence)
        );
    }
    for invalid in [
        Owner::new("App", 0),
        Owner::new("App", 9_007_199_254_740_992),
        Owner::new("", 1),
        Owner::new("a".repeat(257), 1),
    ] {
        assert_eq!(
            session.publish(&packet(1, vec![text_write(&invalid, 1, "bad")])),
            Err(ProtocolError::InvalidIdentity)
        );
    }
    assert_eq!(text_at(session.document(), &owner, 1), "before");
    session.publish(&packet(1, vec![])).unwrap();
}

#[test]
fn wire_packet_and_write_limits_are_enforced_at_the_boundary() {
    let (mut session, shell, owner) = publication_host();
    assert_eq!(
        session.publish(&vec![b' '; MAX_PACKET_BYTES + 1]),
        Err(ProtocolError::PacketTooLarge)
    );
    let writes = vec![text_write(&owner, 1, "candidate"); MAX_WRITES + 1];
    assert_eq!(
        session.publish(&packet(1, writes)),
        Err(ProtocolError::TooManyWrites)
    );
    assert_eq!(text_at(session.document(), &owner, 1), "before");
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);

    // Exact byte capacity still parses; no truncation or character-count limit.
    let mut exact = packet(1, vec![]);
    exact.resize(MAX_PACKET_BYTES, b' ');
    session.publish(&exact).unwrap();
    session
        .publish(&packet(2, vec![text_write(&owner, 1, "ok"); MAX_WRITES]))
        .unwrap();
    assert_eq!(text_at(session.document(), &owner, 1), "ok");
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 1);
}

#[test]
fn wire_namespaced_attribute_replacement_preserves_qualified_identity() {
    let (mut session, _, owner) = publication_host();
    let name =
        json!({"namespace": "http://www.w3.org/1999/xlink", "local": "href", "prefix": "xlink"});
    session.publish(&packet(1, vec![json!({
        "op": "setAttribute", "target": wire_target(&owner, 0), "name": name, "value": "#paint"
    })])).unwrap();
    let node = session
        .document()
        .engine()
        .get_node(session.document().node_id(&owner.node(0)).unwrap())
        .unwrap();
    let NodeData::Element(element) = &node.data else {
        panic!("expected element")
    };
    assert_eq!(
        element.attrs()[0].name,
        QualName::new(Some("xlink".into()), ns!(xlink), "href".into())
    );
    assert_eq!(element.attrs()[0].value, "#paint");
    session
        .publish(&packet(
            2,
            vec![json!({
                "op": "removeAttribute", "target": wire_target(&owner, 0), "name": name
            })],
        ))
        .unwrap();
    let node = session
        .document()
        .engine()
        .get_node(session.document().node_id(&owner.node(0)).unwrap())
        .unwrap();
    let NodeData::Element(element) = &node.data else {
        panic!("expected element")
    };
    assert!(element.attrs().is_empty());
}

#[test]
fn closed_publication_cannot_apply_replay_after_a_lost_acknowledgment() {
    let (mut session, shell, owner) = publication_host();
    session
        .publish(&packet(1, vec![text_write(&owner, 1, "accepted")]))
        .unwrap();
    session.close();
    shell.redraws.store(0, Ordering::SeqCst);
    for sequence in [1, 2] {
        assert_eq!(
            session.publish(&packet(sequence, vec![text_write(&owner, 1, "replay")])),
            Err(ProtocolError::Closed)
        );
    }
    assert_eq!(text_at(session.document(), &owner, 1), "accepted");
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
}
