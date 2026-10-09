use memoized_dom_desktop_host::{Scene, Template, Transaction};
use serde_json::json;

fn template() -> Template {
    serde_json::from_value(json!({"id":"input","nodes":[
        {"kind":"element","tag":"div","parent":null,"text":""},
        {"kind":"element","tag":"input","parent":0,"text":"","attributes":{"type":"text"}},
        {"kind":"element","tag":"p","parent":0,"text":""},
        {"kind":"text","parent":2,"text":""}
    ],"slots":[{"node":1,"type":"value"},{"node":3,"type":"text"}],"events":[{"node":1,"type":"change"}]})).unwrap()
}
#[test]
fn input_value_and_paragraph_publish_atomically_and_control_keeps_identity() {
    let mut scene = Scene::default();
    scene.install(template()).unwrap();
    let mount: Transaction = serde_json::from_value(json!({"sequence":1,"operations":[{"kind":"mount","handle":{"id":1,"generation":1},"template":"input","values":[{"slot":0,"value":""},{"slot":1,"value":""}]}]})).unwrap();
    scene.commit(mount).unwrap();
    let failed: Transaction = serde_json::from_value(json!({"sequence":2,"operations":[{"kind":"update","handle":{"id":1,"generation":1},"values":[{"slot":0,"value":"partial"},{"slot":99,"value":"bad"}]}]})).unwrap();
    assert!(scene.commit(failed).is_err());
    assert_eq!(scene.snapshot().instances[0].texts[1], "");
    let update: Transaction = serde_json::from_value(json!({"sequence":2,"operations":[{"kind":"update","handle":{"id":1,"generation":1},"values":[{"slot":0,"value":"静🙂"},{"slot":1,"value":"静🙂"}]}]})).unwrap();
    scene.commit(update).unwrap();
    let snapshot = scene.snapshot();
    let instance = &snapshot.instances[0];
    assert_eq!(instance.texts[1], "静🙂");
    assert_eq!(instance.text_groups[0].text.as_ref(), "静🙂");
    assert!(matches!(
        instance.presentation[1].kind,
        memoized_dom_desktop_host::presentation::ItemKind::Input
    ));
    assert_eq!(instance.presentation[1].group, None);
    assert!(scene.has_change_event(instance.handle, 0));
    let before = serde_json::to_value(scene.snapshot()).unwrap();
    let acknowledged = memoized_dom_desktop_host::bridge::process_line(
        &mut scene,
        r#"{"id":3,"version":1,"kind":"acknowledge","handle":{"id":1,"generation":1},"site":0,"edit":1}"#,
    );
    assert!(acknowledged.input_ack.is_some());
    assert!(!acknowledged.changed);
    assert_eq!(serde_json::to_value(scene.snapshot()).unwrap(), before);
}
#[test]
fn invalid_types_slots_events_and_children_never_enable_fake_inputs() {
    let mut t = template();
    if let memoized_dom_desktop_host::Node::Element { attributes, .. } = &mut t.nodes[1] {
        attributes.insert("type".into(), "checkbox".into());
    }
    assert!(t.prepare().is_err());
    let mut t = template();
    t.slots[0].node = 0;
    assert!(t.prepare().is_err());
    let mut t = template();
    t.events[0].r#type = memoized_dom_desktop_host::template::EventKind::Click;
    assert!(t.prepare().is_err());
    let mut t = template();
    t.nodes[3] =
        serde_json::from_value(json!({"kind":"text","parent":1,"text":"bad child"})).unwrap();
    assert!(t.prepare().is_err());
}
