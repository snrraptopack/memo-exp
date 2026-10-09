use memoized_dom_desktop_host::{Handle, Scene, Template, Transaction};
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
fn handle(id: u64, generation: u64) -> Value {
    json!({"id":id,"generation":generation})
}
fn mount(id: u64, generation: u64, template: &str, attachment: Option<Value>) -> Value {
    let mut operation =
        json!({"kind":"mount","handle":handle(id,generation),"template":template,"values":[]});
    if let Some(attachment) = attachment {
        operation["attach_to"] = attachment;
    }
    operation
}
fn attach(id: u64, generation: u64, node: usize) -> Value {
    json!({"handle":handle(id,generation),"node":node})
}
fn snapshot(scene: &Scene) -> Value {
    serde_json::to_value(scene.snapshot()).unwrap()
}
fn fixtures(scene: &mut Scene) {
    install(
        scene,
        "parent",
        json!([
            {"kind":"element","tag":"div","parent":null,"text":""},
            {"kind":"element","tag":"button","parent":0,"text":""},
            {"kind":"region","parent":0},
            {"kind":"element","tag":"button","parent":0,"text":""}
        ]),
    );
    install(
        scene,
        "child",
        json!([
            {"kind":"element","tag":"section","parent":null,"text":""},
            {"kind":"element","tag":"input","parent":0,"text":""}
        ]),
    );
}

#[test]
fn authored_traversal_interleaves_controls_and_parent_disposal_retires_children() {
    let mut scene = Scene::default();
    fixtures(&mut scene);
    apply(
        &mut scene,
        1,
        json!([
            mount(8, 1, "parent", None),
            mount(2, 1, "child", Some(attach(8, 1, 2)))
        ]),
    )
    .unwrap();
    let order = scene.presentation_order();
    assert_eq!(
        order
            .instances
            .iter()
            .map(|handle| handle.id)
            .collect::<Vec<_>>(),
        vec![8, 2]
    );
    assert_eq!(
        order
            .controls
            .iter()
            .map(|(handle, node)| (handle.id, *node))
            .collect::<Vec<_>>(),
        vec![(8, 1), (2, 1), (8, 3)]
    );
    apply(
        &mut scene,
        2,
        json!([{"kind":"dispose","handle":handle(8,1)}]),
    )
    .unwrap();
    assert!(scene.snapshot().instances.is_empty());
    assert!(
        apply(&mut scene, 3, json!([mount(2, 1, "child", None)]))
            .unwrap_err()
            .contains("Retired scene generation")
    );
    apply(&mut scene, 3, json!([mount(2, 2, "child", None)])).unwrap();
}

#[test]
fn rejected_attachments_never_publish_records_or_generations() {
    let mut scene = Scene::default();
    fixtures(&mut scene);
    apply(&mut scene, 1, json!([mount(1, 1, "parent", None)])).unwrap();
    let before = snapshot(&scene);
    for attachment in [
        attach(99, 1, 2),
        attach(1, 2, 2),
        attach(1, 1, 0),
        attach(1, 1, 99),
    ] {
        assert!(
            apply(
                &mut scene,
                2,
                json!([mount(2, 1, "child", Some(attachment))])
            )
            .is_err()
        );
        assert_eq!(snapshot(&scene), before);
    }
    assert!(
        apply(
            &mut scene,
            2,
            json!([
                mount(2, 1, "child", Some(attach(1, 1, 2))),
                mount(3, 1, "child", Some(attach(1, 1, 2)))
            ])
        )
        .unwrap_err()
        .contains("occupied")
    );
    assert_eq!(snapshot(&scene), before);
    apply(
        &mut scene,
        2,
        json!([mount(2, 1, "child", Some(attach(1, 1, 2)))]),
    )
    .unwrap();
}

#[test]
fn attachment_cycles_and_region_content_are_rejected_atomically() {
    let mut scene = Scene::default();
    install(
        &mut scene,
        "region",
        json!([{"kind":"region","parent":null}]),
    );
    for operations in [
        json!([mount(1, 1, "region", Some(attach(1, 1, 0)))]),
        json!([
            mount(1, 1, "region", Some(attach(2, 1, 0))),
            mount(2, 1, "region", Some(attach(1, 1, 0)))
        ]),
    ] {
        assert!(
            apply(&mut scene, 1, operations)
                .unwrap_err()
                .contains("cycle")
        );
        assert_eq!(snapshot(&scene), json!({"sequence":0,"instances":[]}));
    }
    for parent in ["p", "span", "button", "ul", "input"] {
        let template: Template=serde_json::from_value(json!({"id":parent,"nodes":[{"kind":"element","tag":parent,"parent":null,"text":""},{"kind":"region","parent":0}],"slots":[],"events":[]})).unwrap();
        assert!(
            scene
                .install(template)
                .unwrap_err()
                .contains("flow container")
        );
    }
}

#[test]
fn disposing_a_child_keeps_its_parent_and_region_available() {
    let mut scene = Scene::default();
    fixtures(&mut scene);
    apply(
        &mut scene,
        1,
        json!([
            mount(1, 1, "parent", None),
            mount(2, 1, "child", Some(attach(1, 1, 2)))
        ]),
    )
    .unwrap();
    apply(
        &mut scene,
        2,
        json!([{"kind":"dispose","handle":handle(2,1)}]),
    )
    .unwrap();
    assert_eq!(scene.snapshot().instances.len(), 1);
    apply(
        &mut scene,
        3,
        json!([mount(2, 2, "child", Some(attach(1, 1, 2)))]),
    )
    .unwrap();
    let before = snapshot(&scene);
    assert!(apply(&mut scene,4,json!([{"kind":"dispose","handle":handle(1,1)},{"kind":"update","handle":handle(2,2),"values":[]}])).is_err());
    assert_eq!(snapshot(&scene), before);
}

#[test]
fn parent_retirement_does_not_retire_children_of_a_future_generation() {
    let mut scene = Scene::default();
    fixtures(&mut scene);
    apply(&mut scene, 1, json!([mount(1, 1, "parent", None)])).unwrap();
    apply(
        &mut scene,
        2,
        json!([
            mount(2, 1, "child", Some(attach(1, 2, 2))),
            {"kind":"dispose", "handle": handle(1, 1)},
            mount(1, 2, "parent", None)
        ]),
    )
    .unwrap();
    assert_eq!(scene.snapshot().instances.len(), 2);
    assert_eq!(
        scene.presentation_order().instances,
        vec![
            Handle {
                id: 1,
                generation: 2
            },
            Handle {
                id: 2,
                generation: 1
            }
        ]
    );
}
