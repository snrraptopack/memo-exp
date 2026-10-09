use memoized_dom_desktop_host::{Scene, Template, Transaction};
use serde_json::{Value, json};

fn install(scene: &mut Scene, id: &str, nodes: Value) {
    scene
        .install(
            serde_json::from_value::<Template>(
                json!({"id":id,"nodes":nodes,"slots":[],"events":[]}),
            )
            .unwrap(),
        )
        .unwrap();
}
fn apply(scene: &mut Scene, sequence: u64, operations: Value) -> Result<u64, String> {
    scene.commit(
        serde_json::from_value::<Transaction>(json!({"sequence":sequence,"operations":operations}))
            .unwrap(),
    )
}
fn h(id: u64) -> Value {
    json!({"id":id,"generation":1})
}
fn row(id: u64) -> Value {
    json!({"kind":"mount","handle":h(id),"template":"row","values":[],"attach_to":{"handle":h(1),"node":1}})
}
fn order(ids: &[u64]) -> Value {
    json!({"kind":"order","handle":h(1),"node":1,"children":ids.iter().map(|&id| h(id)).collect::<Vec<_>>()})
}
fn setup() -> Scene {
    let mut scene = Scene::default();
    install(
        &mut scene,
        "parent",
        json!([{"kind":"element","tag":"ul","parent":null,"text":""},{"kind":"region","parent":0,"multiple":true}]),
    );
    install(
        &mut scene,
        "row",
        json!([{"kind":"element","tag":"li","parent":null,"text":""},{"kind":"element","tag":"button","parent":0,"text":""}]),
    );
    apply(&mut scene, 1, json!([{"kind":"mount","handle":h(1),"template":"parent","values":[]},row(2),row(3),row(4),order(&[2,3,4])])).unwrap();
    scene
}
fn ids(scene: &Scene) -> Vec<u64> {
    scene
        .presentation_order()
        .instances
        .iter()
        .map(|handle| handle.id)
        .collect()
}

#[test]
fn row_order_controls_authored_layout_and_focus_without_replacing_records() {
    let mut scene = setup();
    apply(&mut scene, 2, json!([order(&[4, 2, 3])])).unwrap();
    assert_eq!(ids(&scene), vec![1, 4, 2, 3]);
    assert_eq!(
        scene
            .presentation_order()
            .controls
            .iter()
            .map(|(handle, _)| handle.id)
            .collect::<Vec<_>>(),
        vec![4, 2, 3]
    );
    apply(
        &mut scene,
        3,
        json!([{"kind":"dispose","handle":h(2)},row(5),order(&[5,4,3])]),
    )
    .unwrap();
    assert_eq!(ids(&scene), vec![1, 5, 4, 3]);
    apply(&mut scene, 4, json!([{"kind":"dispose","handle":h(1)}])).unwrap();
    assert!(scene.snapshot().instances.is_empty());
}

#[test]
fn invalid_orders_preserve_the_entire_scene_and_sequence() {
    let mut scene = setup();
    let before = serde_json::to_value(scene.snapshot()).unwrap();
    for operation in [
        order(&[2, 2, 4]),
        order(&[2, 3]),
        order(&[2, 3, 99]),
        json!({"kind":"order","handle":h(1),"node":1,"children":[h(2),h(3),{"id":4,"generation":2}]}),
        json!({"kind":"order","handle":h(1),"node":0,"children":[]}),
    ] {
        assert!(apply(&mut scene, 2, json!([operation])).is_err());
        assert_eq!(serde_json::to_value(scene.snapshot()).unwrap(), before);
    }
    assert!(apply(&mut scene, 2, json!([row(5)])).is_err());
    assert_eq!(serde_json::to_value(scene.snapshot()).unwrap(), before);
    apply(&mut scene, 2, json!([row(5), order(&[5, 2, 3, 4])])).unwrap();
    assert_eq!(ids(&scene), vec![1, 5, 2, 3, 4]);
}

#[test]
fn row_content_is_validated_at_its_actual_component_placement() {
    let mut scene = setup();
    install(
        &mut scene,
        "wrong",
        json!([{"kind":"element","tag":"div","parent":null,"text":""}]),
    );
    let before = serde_json::to_value(scene.snapshot()).unwrap();
    assert!(apply(&mut scene, 2, json!([{"kind":"mount","handle":h(5),"template":"wrong","values":[],"attach_to":{"handle":h(1),"node":1}},order(&[2,3,4,5])])).unwrap_err().contains("content contract"));
    assert_eq!(serde_json::to_value(scene.snapshot()).unwrap(), before);
    assert!(
        apply(
            &mut scene,
            2,
            json!([{"kind":"mount","handle":h(5),"template":"row","values":[]}])
        )
        .unwrap_err()
        .contains("<li> requires")
    );
    install(
        &mut scene,
        "proxy",
        json!([{"kind":"region","parent":null}]),
    );
    apply(&mut scene, 2, json!([{"kind":"mount","handle":h(5),"template":"proxy","values":[],"attach_to":{"handle":h(1),"node":1}},{"kind":"mount","handle":h(6),"template":"row","values":[],"attach_to":{"handle":h(5),"node":0}},order(&[2,3,4,5])])).unwrap();
    assert_eq!(ids(&scene), vec![1, 2, 3, 4, 5, 6]);
}

#[test]
fn single_component_regions_still_reject_multiple_children_and_orders() {
    let mut scene = Scene::default();
    install(
        &mut scene,
        "single",
        json!([{"kind":"region","parent":null}]),
    );
    install(
        &mut scene,
        "leaf",
        json!([{"kind":"element","tag":"p","parent":null,"text":""}]),
    );
    let root = json!({"kind":"mount","handle":h(1),"template":"single","values":[]});
    let child = |id| json!({"kind":"mount","handle":h(id),"template":"leaf","values":[],"attach_to":{"handle":h(1),"node":0}});
    assert!(
        apply(&mut scene, 1, json!([root, child(2), child(3)]))
            .unwrap_err()
            .contains("occupied")
    );
    assert!(
        apply(
            &mut scene,
            1,
            json!([root,child(2),{"kind":"order","handle":h(1),"node":0,"children":[h(2)]}])
        )
        .unwrap_err()
        .contains("ordered region")
    );
    assert!(scene.snapshot().instances.is_empty());
}

#[test]
fn ordered_markers_follow_live_rows_between_static_siblings_and_survive_rejection() {
    let mut scene = Scene::default();
    install(
        &mut scene,
        "ordered",
        json!([
            {"kind":"element","tag":"ol","parent":null,"text":""},
            {"kind":"element","tag":"li","parent":0,"text":""},{"kind":"text","parent":1,"text":"first"},
            {"kind":"region","parent":0,"multiple":true},
            {"kind":"element","tag":"li","parent":0,"text":""},{"kind":"text","parent":4,"text":"last"}
        ]),
    );
    install(
        &mut scene,
        "row",
        json!([{"kind":"element","tag":"li","parent":null,"text":""},{"kind":"element","tag":"button","parent":0,"text":""}]),
    );
    let mut a = row(2);
    a["attach_to"]["node"] = json!(3);
    let mut b = row(3);
    b["attach_to"]["node"] = json!(3);
    let ordered = |ids: &[u64]| json!({"kind":"order","handle":h(1),"node":3,"children":ids.iter().map(|&id| h(id)).collect::<Vec<_>>()});
    apply(&mut scene, 1, json!([{"kind":"mount","handle":h(1),"template":"ordered","values":[]},a,b,ordered(&[2,3])])).unwrap();
    let before = serde_json::to_value(scene.snapshot()).unwrap();
    assert_eq!(before["instances"][0]["text_groups"][1]["text"], "4. last");
    assert_eq!(before["instances"][1]["text_groups"][0]["text"], "2. ");
    assert!(apply(&mut scene, 2, json!([ordered(&[3, 3])])).is_err());
    assert_eq!(serde_json::to_value(scene.snapshot()).unwrap(), before);
    apply(&mut scene, 2, json!([ordered(&[3, 2])])).unwrap();
    let after = serde_json::to_value(scene.snapshot()).unwrap();
    assert_eq!(after["instances"][1]["text_groups"][0]["text"], "3. ");
    assert_eq!(after["instances"][2]["text_groups"][0]["text"], "2. ");
    assert_eq!(
        after["instances"][0]["text_groups"],
        before["instances"][0]["text_groups"]
    );
}
