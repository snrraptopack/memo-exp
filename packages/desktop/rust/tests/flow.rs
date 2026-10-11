use memoized_dom_desktop_host::{Scene, Template, Transaction, presentation::ItemKind};
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

fn handle(id: u64) -> Value {
    json!({"id": id, "generation": 1})
}

fn mount(id: u64, template: &str, parent: Option<(u64, usize)>, values: Value) -> Value {
    let mut operation =
        json!({"kind":"mount","handle":handle(id),"template":template,"values":values});
    if let Some((id, node)) = parent {
        operation["attach_to"] = json!({"handle":handle(id),"node":node});
    }
    operation
}

fn update(id: u64, value: &str) -> Value {
    json!({"kind":"update","handle":handle(id),"values":[{"slot":0,"value":value}]})
}

fn texts(scene: &Scene) -> Vec<&str> {
    scene
        .flow()
        .values()
        .iter()
        .map(|group| group.text.as_ref())
        .collect()
}

fn setup() -> Scene {
    let mut scene = Scene::default();
    install(
        &mut scene,
        "parent",
        json!([
            {"kind":"element","tag":"div","parent":null,"text":""},
            {"kind":"text","parent":0,"text":"Before "},
            {"kind":"region","parent":0},
            {"kind":"text","parent":0,"text":" after"}
        ]),
        json!([]),
    );
    install(
        &mut scene,
        "inline",
        json!([
            {"kind":"element","tag":"strong","parent":null,"text":""},
            {"kind":"text","parent":0,"text":""}
        ]),
        json!([{"node":1,"type":"text"}]),
    );
    install(
        &mut scene,
        "block",
        json!([
            {"kind":"element","tag":"p","parent":null,"text":""},
            {"kind":"text","parent":0,"text":"Block"}
        ]),
        json!([]),
    );
    scene
        .commit(transaction(
            1,
            json!([
                mount(1, "parent", None, json!([])),
                mount(
                    2,
                    "inline",
                    Some((1, 2)),
                    json!([{"slot":0,"value":"middle🙂"}])
                )
            ]),
        ))
        .unwrap();
    scene
}

#[test]
fn inline_component_roots_join_the_surrounding_anonymous_paragraph() {
    let scene = setup();
    assert_eq!(texts(&scene), ["Before middle🙂 after"]);
    let items = scene.flow().items();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0].kind, ItemKind::Container);
    assert!(items[1].anonymous());
    assert_eq!(items[1].parent, Some(0));
    let run = &scene.flow().values()[0].runs[1];
    assert_eq!(run.len, "middle🙂".len());
    let path = run.path.as_ref().unwrap();
    assert_eq!(path.source.handle.id, 2);
    assert_eq!(path.ancestry[0].handle.id, 2);
    assert_eq!(path.ancestry[0].node, 0);
}

#[test]
fn component_roots_split_and_rejoin_flow_when_the_selected_branch_changes() {
    let mut scene = setup();
    let anchor = scene.flow().text_identity(0);
    scene
        .commit(transaction(
            2,
            json!([
                {"kind":"dispose","handle":handle(2)},
                mount(3, "block", Some((1, 2)), json!([]))
            ]),
        ))
        .unwrap();
    assert_eq!(texts(&scene), ["Before ", "Block", " after"]);
    assert_eq!(scene.flow().text_identity(0), anchor);
    assert_eq!(scene.flow().items()[2].source.handle.id, 3);
    assert!(!scene.flow().items()[2].anonymous());
    scene
        .commit(transaction(
            3,
            json!([
                {"kind":"dispose","handle":handle(3)},
                mount(4, "inline", Some((1, 2)), json!([{"slot":0,"value":"restored"}]))
            ]),
        ))
        .unwrap();
    assert_eq!(texts(&scene), ["Before restored after"]);
    assert_eq!(scene.flow().text_identity(0), anchor);
}

#[test]
fn mixed_fragment_roots_keep_authored_order_without_region_boxes() {
    let mut scene = setup();
    install(
        &mut scene,
        "mixed",
        json!([
            {"kind":"element","tag":"em","parent":null,"text":""},
            {"kind":"text","parent":0,"text":"A"},
            {"kind":"element","tag":"p","parent":null,"text":""},
            {"kind":"text","parent":2,"text":"Block"},
            {"kind":"element","tag":"span","parent":null,"text":""},
            {"kind":"text","parent":4,"text":"Z"}
        ]),
        json!([]),
    );
    scene
        .commit(transaction(
            2,
            json!([
                {"kind":"dispose","handle":handle(2)},
                mount(3, "mixed", Some((1, 2)), json!([]))
            ]),
        ))
        .unwrap();
    assert_eq!(texts(&scene), ["Before A", "Block", "Z after"]);
    assert_eq!(
        scene
            .flow()
            .items()
            .iter()
            .map(|item| item.kind)
            .collect::<Vec<_>>(),
        [
            ItemKind::Container,
            ItemKind::Paragraph,
            ItemKind::Paragraph,
            ItemKind::Paragraph
        ]
    );
}

#[test]
fn slot_edits_share_paths_and_final_restored_writes_keep_the_flow_revision() {
    let mut scene = setup();
    let path = scene.flow().values()[0].runs[1]
        .path
        .as_ref()
        .unwrap()
        .clone();
    scene
        .commit(transaction(2, json!([update(2, "changed")])))
        .unwrap();
    assert_eq!(texts(&scene), ["Before changed after"]);
    assert_eq!(scene.flow().values()[0].revision, 2);
    assert!(std::sync::Arc::ptr_eq(
        &path,
        scene.flow().values()[0].runs[1].path.as_ref().unwrap()
    ));
    scene
        .commit(transaction(
            3,
            json!([update(2, "transient"), update(2, "changed")]),
        ))
        .unwrap();
    assert_eq!(scene.flow().values()[0].revision, 2);
}

#[test]
fn native_rejection_preserves_placed_flow_and_its_old_source_dependencies() {
    let mut scene = setup();
    let before = serde_json::to_value(scene.snapshot()).unwrap();
    let replacement = || {
        transaction(
            2,
            json!([
                {"kind":"dispose","handle":handle(2)},
                mount(3, "block", Some((1, 2)), json!([]))
            ]),
        )
    };
    assert!(
        scene
            .commit_with(replacement(), |_| Err("refused".into()))
            .is_err()
    );
    assert_eq!(serde_json::to_value(scene.snapshot()).unwrap(), before);
    scene
        .commit(transaction(2, json!([update(2, "still live")])))
        .unwrap();
    assert_eq!(texts(&scene), ["Before still live after"]);
}

#[test]
fn ordered_multiroot_rows_compose_in_live_row_order() {
    let mut scene = Scene::default();
    install(
        &mut scene,
        "parent",
        json!([
            {"kind":"element","tag":"div","parent":null,"text":""},
            {"kind":"region","parent":0,"multiple":true}
        ]),
        json!([]),
    );
    for (id, first, last) in [("a", "A", "a"), ("b", "B", "b")] {
        install(
            &mut scene,
            id,
            json!([
                {"kind":"element","tag":"strong","parent":null,"text":""},
                {"kind":"text","parent":0,"text":first},
                {"kind":"element","tag":"em","parent":null,"text":""},
                {"kind":"text","parent":2,"text":last}
            ]),
            json!([]),
        );
    }
    let order = |ids: Vec<u64>| {
        json!({"kind":"order","handle":handle(1),"node":1,
        "children":ids.into_iter().map(handle).collect::<Vec<_>>()})
    };
    scene
        .commit(transaction(
            1,
            json!([
                mount(1, "parent", None, json!([])),
                mount(2, "a", Some((1, 1)), json!([])),
                mount(3, "b", Some((1, 1)), json!([])),
                order(vec![2, 3])
            ]),
        ))
        .unwrap();
    assert_eq!(texts(&scene), ["AaBb"]);
    scene
        .commit(transaction(2, json!([order(vec![3, 2])])))
        .unwrap();
    assert_eq!(texts(&scene), ["BbAa"]);
    assert_eq!(scene.instances().count(), 3);
}

#[test]
fn flex_and_grid_preserve_element_items_and_regroup_on_accepted_display_changes() {
    for display in ["flex", "grid"] {
        let mut scene = Scene::default();
        install(
            &mut scene,
            "parent",
            json!([
                {"kind":"element","tag":"div","parent":null,"text":"","style":[{"property":"display","value":display}]},
                {"kind":"region","parent":0}
            ]),
            json!([]),
        );
        install(
            &mut scene,
            "child",
            json!([
                {"kind":"text","parent":null,"text":"A"},
                {"kind":"element","tag":"span","parent":null,"text":""},
                {"kind":"text","parent":1,"text":"B"},
                {"kind":"element","tag":"em","parent":null,"text":""},
                {"kind":"text","parent":3,"text":"C"},
                {"kind":"text","parent":null,"text":"D"}
            ]),
            json!([]),
        );
        scene
            .commit(transaction(
                1,
                json!([
                    mount(1, "parent", None, json!([])),
                    mount(2, "child", Some((1, 1)), json!([]))
                ]),
            ))
            .unwrap();
        assert_eq!(texts(&scene), ["A", "B", "C", "D"]);
        assert_eq!(
            scene
                .flow()
                .items()
                .iter()
                .map(|item| item.anonymous())
                .collect::<Vec<_>>(),
            [false, true, false, false, true]
        );
        let property = |value: &str| {
            json!({"kind":"properties","handle":handle(1),
            "properties":[{"node":0,"attributes":{},"style":format!("display: {value}")}]})
        };
        scene
            .commit(transaction(2, json!([property("block")])))
            .unwrap();
        assert_eq!(texts(&scene), ["ABCD"]);
        scene
            .commit(transaction(3, json!([property(display)])))
            .unwrap();
        assert_eq!(texts(&scene), ["A", "B", "C", "D"]);
    }
}

#[test]
fn list_markers_join_placed_inline_content_and_keep_live_order() {
    let mut scene = Scene::default();
    install(
        &mut scene,
        "parent",
        json!([
            {"kind":"element","tag":"ol","parent":null,"text":""},
            {"kind":"region","parent":0,"multiple":true}
        ]),
        json!([]),
    );
    install(
        &mut scene,
        "row",
        json!([
            {"kind":"element","tag":"li","parent":null,"text":""},
            {"kind":"region","parent":0}
        ]),
        json!([]),
    );
    install(
        &mut scene,
        "inline",
        json!([
            {"kind":"element","tag":"span","parent":null,"text":""},
            {"kind":"text","parent":0,"text":"value"}
        ]),
        json!([]),
    );
    let order = |ids: Vec<u64>| {
        json!({"kind":"order","handle":handle(1),"node":1,
        "children":ids.into_iter().map(handle).collect::<Vec<_>>()})
    };
    scene
        .commit(transaction(
            1,
            json!([
                mount(1, "parent", None, json!([])),
                mount(2, "row", Some((1, 1)), json!([])),
                mount(3, "row", Some((1, 1)), json!([])),
                mount(4, "inline", Some((2, 1)), json!([])),
                mount(5, "inline", Some((3, 1)), json!([])),
                order(vec![2, 3])
            ]),
        ))
        .unwrap();
    assert_eq!(texts(&scene), ["1. value", "2. value"]);
    scene
        .commit(transaction(2, json!([order(vec![3, 2])])))
        .unwrap();
    assert_eq!(texts(&scene), ["1. value", "2. value"]);
    assert_eq!(scene.flow().items()[1].source.handle.id, 3);
}

#[test]
fn independent_application_roots_do_not_share_an_anonymous_paragraph() {
    let mut scene = Scene::default();
    install(
        &mut scene,
        "inline",
        json!([
            {"kind":"element","tag":"span","parent":null,"text":""},
            {"kind":"text","parent":0,"text":"root"}
        ]),
        json!([]),
    );
    scene
        .commit(transaction(
            1,
            json!([
                mount(1, "inline", None, json!([])),
                mount(2, "inline", None, json!([]))
            ]),
        ))
        .unwrap();
    assert_eq!(texts(&scene), ["root", "root"]);
    assert!(scene.flow().items().iter().all(|item| !item.anonymous()));
    assert_eq!(
        scene
            .flow()
            .items()
            .iter()
            .filter(|item| item.parent.is_none())
            .count(),
        2
    );
}

#[test]
fn interaction_display_regrouping_rejects_without_changing_accepted_flow() {
    let mut scene = setup();
    let sheet: Template = serde_json::from_value(json!({
        "id":"interaction-flow",
        "nodes":[{"kind":"element","tag":"div","parent":null,"text":""}],
        "slots":[], "events":[],
        "stylesheets":[{
            "selectors":[[{
                "combinator":null,
                "selectors":[{"type":"class","name":"changing"},{"type":"state","name":"hover"}]
            }]],
            "declarations":[{"property":"display","value":"flex"}]
        }]
    }))
    .unwrap();
    scene.install(sheet).unwrap();
    scene.commit(transaction(2, json!([]))).unwrap();
    let before = serde_json::to_value(scene.snapshot()).unwrap();
    let properties = json!([{
        "kind":"properties", "handle":handle(1),
        "properties":[{"node":0,"attributes":{"class":"changing"},"style":[]}]
    }]);
    let error = scene.commit(transaction(3, properties)).unwrap_err();
    assert!(error.contains("native flow regrouping"), "{error}");
    assert_eq!(serde_json::to_value(scene.snapshot()).unwrap(), before);
    scene
        .commit(transaction(3, json!([update(2, "still accepted")])))
        .unwrap();
    assert_eq!(texts(&scene), ["Before still accepted after"]);
}

#[test]
fn inline_events_require_a_real_box_and_regrouping_rejects_atomically() {
    let mut scene = Scene::default();
    install(
        &mut scene,
        "parent",
        json!([
            {"kind":"element","tag":"div","parent":null,"text":"",
                "style":[{"property":"display","value":"flex"}]},
            {"kind":"region","parent":0}
        ]),
        json!([]),
    );
    let leaf: Template = serde_json::from_value(json!({
        "id":"interactive-inline",
        "nodes":[
            {"kind":"element","tag":"span","parent":null,"text":""},
            {"kind":"text","parent":0,"text":""}
        ],
        "slots":[{"node":1,"type":"text"}],
        "events":[{"node":0,"type":"click"},{"node":0,"type":"pointerdown"},{"node":0,"type":"pointerup"}]
    }))
    .unwrap();
    scene.install(leaf).unwrap();
    scene
        .commit(transaction(
            1,
            json!([
                mount(1, "parent", None, json!([])),
                mount(
                    2,
                    "interactive-inline",
                    Some((1, 1)),
                    json!([{"slot":0,"value":"Click"}])
                )
            ]),
        ))
        .unwrap();
    assert_eq!(
        scene.flow().boxed_inline(2).unwrap().as_ref(),
        &std::collections::BTreeSet::from([0])
    );
    let before = serde_json::to_value(scene.snapshot()).unwrap();
    let error = scene
        .commit(transaction(
            2,
            json!([{
                "kind":"properties", "handle":handle(1),
                "properties":[{"node":0,"attributes":{},"style":"display: block"}]
            }]),
        ))
        .unwrap_err();
    assert!(
        error.contains("inline events require an independent native box"),
        "{error}"
    );
    assert_eq!(serde_json::to_value(scene.snapshot()).unwrap(), before);
    scene
        .commit(transaction(2, json!([update(2, "Still clickable")])))
        .unwrap();
    assert_eq!(texts(&scene), ["Still clickable"]);
}

#[test]
fn boxed_inline_containers_regroup_their_own_phrasing_children() {
    let mut scene = Scene::default();
    install(
        &mut scene,
        "inline-container",
        json!([
            {"kind":"element","tag":"span","parent":null,"text":"",
                "style":[{"property":"display","value":"grid"}]},
            {"kind":"element","tag":"strong","parent":0,"text":""},
            {"kind":"text","parent":1,"text":"A"},
            {"kind":"element","tag":"em","parent":0,"text":""},
            {"kind":"text","parent":3,"text":"B"}
        ]),
        json!([]),
    );
    scene
        .commit(transaction(
            1,
            json!([mount(1, "inline-container", None, json!([]))]),
        ))
        .unwrap();
    assert_eq!(texts(&scene), ["A", "B"]);
    assert_eq!(
        scene.flow().boxed_inline(1).unwrap().as_ref(),
        &std::collections::BTreeSet::from([0, 1, 3])
    );
    scene
        .commit(transaction(
            2,
            json!([{
                "kind":"properties", "handle":handle(1),
                "properties":[{"node":0,"attributes":{},"style":"display: block"}]
            }]),
        ))
        .unwrap();
    assert_eq!(texts(&scene), ["AB"]);
    assert_eq!(
        scene.flow().boxed_inline(1).unwrap().as_ref(),
        &std::collections::BTreeSet::from([0])
    );
}
