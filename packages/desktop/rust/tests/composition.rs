use memoized_dom_desktop_host::{Handle, Instance, Scene, Template, Transaction};
use serde_json::{Value, json};

fn install(scene: &mut Scene, id: &str, nodes: Value, slots: Value) {
    let template: Template = serde_json::from_value(json!({
        "id": id, "nodes": nodes, "slots": slots, "events": []
    }))
    .unwrap();
    scene.install(template).unwrap();
}

fn transaction(sequence: u64, operations: Value) -> Transaction {
    serde_json::from_value(json!({"sequence": sequence, "operations": operations})).unwrap()
}

fn mount(id: u64, template: &str, parent: Value, value: &str) -> Value {
    json!({
        "kind": "mount", "handle": {"id": id, "generation": 1},
        "template": template, "attach_to": parent,
        "values": if template == "inline" { json!([{"slot": 0, "value": value}]) } else { json!([]) }
    })
}

fn attachment(id: u64, node: usize) -> Value {
    json!({"handle": {"id": id, "generation": 1}, "node": node})
}

fn update(id: u64, value: &str) -> Value {
    json!({"kind": "update", "handle": {"id": id, "generation": 1},
        "values": [{"slot": 0, "value": value}]})
}

fn instance(scene: &Scene, id: u64) -> &Instance {
    scene
        .instances()
        .find(|instance| instance.handle.id == id)
        .unwrap()
}

fn setup() -> Scene {
    let mut scene = Scene::default();
    install(
        &mut scene,
        "parent",
        json!([
            {"kind":"element", "tag":"div", "parent":null, "text":""},
            {"kind":"element", "tag":"p", "parent":0, "text":""},
            {"kind":"text", "parent":1, "text":"Before "},
            {"kind":"region", "parent":1},
            {"kind":"text", "parent":1, "text":" after"},
            {"kind":"element", "tag":"button", "parent":0, "text":""},
            {"kind":"text", "parent":5, "text":"Go "},
            {"kind":"element", "tag":"strong", "parent":5, "text":""},
            {"kind":"region", "parent":7},
            {"kind":"text", "parent":5, "text":"!"},
            {"kind":"element", "tag":"p", "parent":0, "text":""},
            {"kind":"text", "parent":10, "text":"untouched"}
        ]),
        json!([]),
    );
    install(
        &mut scene,
        "inline",
        json!([
            {"kind":"element", "tag":"span", "parent":null, "text":"", "style":[{"property":"color","value":"red"}]},
            {"kind":"text", "parent":0, "text":""}
        ]),
        json!([{"node":1,"type":"text"}]),
    );
    install(
        &mut scene,
        "wrapper",
        json!([{"kind":"region","parent":null}]),
        json!([]),
    );
    scene
        .commit(transaction(
            1,
            json!([
                mount(1, "parent", Value::Null, ""),
                mount(2, "inline", attachment(1, 3), "🙂"),
                mount(3, "wrapper", attachment(1, 8), ""),
                mount(4, "inline", attachment(3, 0), "bold")
            ]),
        ))
        .unwrap();
    scene
}

#[test]
fn paragraphs_and_controls_compose_utf8_runs_through_region_only_wrappers() {
    let scene = setup();
    let parent = instance(&scene, 1);
    assert_eq!(
        parent
            .text_groups
            .iter()
            .map(|group| group.text.as_ref())
            .collect::<Vec<_>>(),
        ["Before 🙂 after", "Go bold!", "untouched"]
    );
    assert!(parent.text_groups.iter().all(|group| group.revision == 1));
    let run = &parent.text_groups[0].runs[1];
    assert_eq!(run.len, "🙂".len());
    assert_eq!(run.path.as_ref().unwrap().source.handle.id, 2);
    assert_eq!(
        run.path
            .as_ref()
            .unwrap()
            .ancestry
            .iter()
            .map(|source| (source.handle.id, source.node))
            .collect::<Vec<_>>(),
        [(2, 0)]
    );
    let bold = &parent.text_groups[1].runs[1];
    assert_eq!(
        bold.path
            .as_ref()
            .unwrap()
            .ancestry
            .iter()
            .map(|source| (source.handle.id, source.node))
            .collect::<Vec<_>>(),
        [(1, 7), (4, 0)]
    );
    // Embedded owners still exist in authored order, even though they have no
    // independent layout item or control in the surrounding paragraph.
    let order = scene.presentation_order();
    assert_eq!(
        order
            .instances
            .iter()
            .map(|handle| handle.id)
            .collect::<Vec<_>>(),
        [1, 2, 3, 4]
    );
    assert_eq!(
        order.controls,
        [(
            Handle {
                id: 1,
                generation: 1
            },
            5
        )]
    );
}

#[test]
fn child_edits_refresh_only_their_enclosing_group_once_per_transaction() {
    let mut scene = setup();
    scene
        .commit(transaction(2, json!([update(2, "a"), update(2, "ab🙂")])))
        .unwrap();
    let parent = instance(&scene, 1);
    assert_eq!(parent.text_groups[0].text.as_ref(), "Before ab🙂 after");
    assert_eq!(parent.text_groups[0].revision, 2);
    assert_eq!(parent.text_groups[1].revision, 1);
    assert_eq!(parent.text_groups[2].revision, 1);
    scene
        .commit(transaction(
            3,
            json!([update(2, "temporary"), update(2, "ab🙂")]),
        ))
        .unwrap();
    assert_eq!(instance(&scene, 1).text_groups[0].revision, 2);
    scene
        .commit(transaction(4, json!([update(4, "label")])))
        .unwrap();
    assert_eq!(
        instance(&scene, 1).text_groups[1].text.as_ref(),
        "Go label!"
    );
    assert_eq!(instance(&scene, 1).text_groups[1].revision, 2);
    assert_eq!(instance(&scene, 1).text_groups[0].revision, 2);
}

#[test]
fn rejected_native_preparation_preserves_composed_values_and_dependencies() {
    let mut scene = setup();
    let before = serde_json::to_value(scene.snapshot()).unwrap();
    let error = scene
        .commit_with(transaction(2, json!([update(4, "new")])), |records| {
            assert!(records.iter().any(|instance| instance.handle.id == 1
                && instance.text_groups[1].text.as_ref() == "Go new!"));
            Err("native preparation rejected".into())
        })
        .unwrap_err();
    assert_eq!(error, "native preparation rejected");
    assert_eq!(serde_json::to_value(scene.snapshot()).unwrap(), before);
    scene
        .commit(transaction(2, json!([update(4, "new")])))
        .unwrap();
    assert_eq!(instance(&scene, 1).text_groups[1].revision, 2);
}

#[test]
fn rejected_topology_keeps_old_source_paths_and_retry_does_not_consume_handles() {
    let mut scene = setup();
    let replace = || {
        transaction(
            2,
            json!([
                {"kind":"dispose","handle":{"id":2,"generation":1}},
                mount(5, "inline", attachment(1, 3), "replacement")
            ]),
        )
    };
    let error = scene
        .commit_with(replace(), |records| {
            let parent = records
                .iter()
                .find(|instance| instance.handle.id == 1)
                .unwrap();
            assert_eq!(
                parent.text_groups[0].text.as_ref(),
                "Before replacement after"
            );
            assert_eq!(
                parent.text_groups[0].runs[1]
                    .path
                    .as_ref()
                    .unwrap()
                    .source
                    .handle
                    .id,
                5
            );
            Err("topology refused".into())
        })
        .unwrap_err();
    assert_eq!(error, "topology refused");
    assert_eq!(
        instance(&scene, 1).text_groups[0].runs[1]
            .path
            .as_ref()
            .unwrap()
            .source
            .handle
            .id,
        2
    );

    // Retry the same sequence/identity. No provisional dependency or generation
    // may have replaced the accepted owner while native preparation rejected.
    scene.commit(replace()).unwrap();
    scene
        .commit(transaction(3, json!([update(5, "live")])))
        .unwrap();
    assert_eq!(
        instance(&scene, 1).text_groups[0].text.as_ref(),
        "Before live after"
    );
}

#[test]
fn slot_edits_share_composition_paths_and_property_edits_keep_content_revisions() {
    let mut scene = setup();
    let path = instance(&scene, 1).text_groups[0].runs[1]
        .path
        .as_ref()
        .unwrap()
        .clone();
    scene
        .commit(transaction(2, json!([update(2, "new")])))
        .unwrap();
    let current = instance(&scene, 1).text_groups[0].runs[1]
        .path
        .as_ref()
        .unwrap();
    assert!(std::sync::Arc::ptr_eq(&path, current));
    let revision = instance(&scene, 1).text_groups[0].revision;
    scene
        .commit(transaction(
            3,
            json!([{
                "kind":"properties", "handle":{"id":2,"generation":1},
                "properties":[{"node":0,"attributes":{},"style":"color: blue"}]
            }]),
        ))
        .unwrap();
    assert_eq!(instance(&scene, 1).text_groups[0].revision, revision);
    assert_eq!(instance(&scene, 2).styles[0].states[0]["color"], "blue");
}

#[test]
fn invalid_component_roots_are_rejected_through_forwarding_regions() {
    let mut scene = setup();
    install(
        &mut scene,
        "block",
        json!([
            {"kind":"element","tag":"div","parent":null,"text":""}
        ]),
        json!([]),
    );
    let before = serde_json::to_value(scene.snapshot()).unwrap();
    let error = scene
        .commit(transaction(
            2,
            json!([
                {"kind":"dispose","handle":{"id":4,"generation":1}},
                mount(5, "block", attachment(3, 0), "")
            ]),
        ))
        .unwrap_err();
    assert!(error.contains("content contract"));
    assert_eq!(serde_json::to_value(scene.snapshot()).unwrap(), before);
    scene
        .commit(transaction(2, json!([update(4, "still live")])))
        .unwrap();
    assert_eq!(
        instance(&scene, 1).text_groups[1].text.as_ref(),
        "Go still live!"
    );
}

#[test]
fn ordered_inline_rows_keep_native_identities_and_styles_when_moved_or_removed() {
    let mut scene = Scene::default();
    install(
        &mut scene,
        "parent",
        json!([
            {"kind":"element","tag":"p","parent":null,"text":""},
            {"kind":"text","parent":0,"text":"["},
            {"kind":"region","parent":0,"multiple":true},
            {"kind":"text","parent":0,"text":"]"}
        ]),
        json!([]),
    );
    install(
        &mut scene,
        "inline",
        json!([
            {"kind":"element","tag":"em","parent":null,"text":""},
            {"kind":"text","parent":0,"text":""}
        ]),
        json!([{"node":1,"type":"text"}]),
    );
    let order = |ids: Vec<u64>| {
        json!({"kind":"order","handle":{"id":1,"generation":1},"node":2,
        "children":ids.into_iter().map(|id| json!({"id":id,"generation":1})).collect::<Vec<_>>()})
    };
    scene
        .commit(transaction(
            1,
            json!([
                mount(1, "parent", Value::Null, ""),
                mount(2, "inline", attachment(1, 2), "A"),
                mount(3, "inline", attachment(1, 2), "B"),
                order(vec![2, 3])
            ]),
        ))
        .unwrap();
    assert_eq!(instance(&scene, 1).text_groups[0].text.as_ref(), "[AB]");
    scene
        .commit(transaction(2, json!([order(vec![3, 2])])))
        .unwrap();
    assert_eq!(instance(&scene, 1).text_groups[0].text.as_ref(), "[BA]");
    assert_eq!(
        instance(&scene, 1).text_groups[0].runs[1]
            .path
            .as_ref()
            .unwrap()
            .source
            .handle
            .id,
        3
    );
    assert_eq!(
        scene
            .presentation_order()
            .instances
            .iter()
            .map(|handle| handle.id)
            .collect::<Vec<_>>(),
        [1, 3, 2]
    );
    scene
        .commit(transaction(
            3,
            json!([
                {"kind":"dispose","handle":{"id":3,"generation":1}}, order(vec![2])
            ]),
        ))
        .unwrap();
    assert_eq!(instance(&scene, 1).text_groups[0].text.as_ref(), "[A]");
    scene
        .commit(transaction(4, json!([update(2, "retained🙂")])))
        .unwrap();
    assert_eq!(
        instance(&scene, 1).text_groups[0].text.as_ref(),
        "[retained🙂]"
    );
}

#[test]
fn empty_dynamic_text_and_line_breaks_survive_composition() {
    let mut scene = Scene::default();
    install(
        &mut scene,
        "parent",
        json!([
            {"kind":"element","tag":"span","parent":null,"text":""},
            {"kind":"region","parent":0}
        ]),
        json!([]),
    );
    install(
        &mut scene,
        "inline",
        json!([
            {"kind":"text","parent":null,"text":""},
            {"kind":"element","tag":"br","parent":null,"text":""},
            {"kind":"element","tag":"strong","parent":null,"text":""},
            {"kind":"text","parent":2,"text":"end"}
        ]),
        json!([{"node":0,"type":"text"}]),
    );
    scene
        .commit(transaction(
            1,
            json!([
                mount(1, "parent", Value::Null, ""),
                mount(2, "inline", attachment(1, 1), "")
            ]),
        ))
        .unwrap();
    assert_eq!(instance(&scene, 1).text_groups[0].text.as_ref(), "\nend");
    scene
        .commit(transaction(2, json!([update(2, "start")])))
        .unwrap();
    assert_eq!(
        instance(&scene, 1).text_groups[0].text.as_ref(),
        "start\nend"
    );
}

#[test]
fn empty_controls_do_not_accept_structural_regions() {
    let template: Template = serde_json::from_value(json!({"id":"invalid", "nodes":[
        {"kind":"element","tag":"input","parent":null,"text":""},
        {"kind":"region","parent":0}
    ], "slots":[], "events":[]}))
    .unwrap();
    assert!(
        Scene::default()
            .install(template)
            .unwrap_err()
            .contains("empty <input>")
    );
}
