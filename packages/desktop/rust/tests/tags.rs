use memoized_dom_desktop_host::{Scene, Template, Transaction};
use serde_json::{Value, json};

fn install(scene: &mut Scene, nodes: Value, slots: Value, events: Value) -> Result<(), String> {
    let template: Template =
        serde_json::from_value(json!({"id":"tags", "nodes":nodes, "slots":slots, "events":events}))
            .unwrap();
    scene.install(template)
}
fn apply(scene: &mut Scene, sequence: u64, operations: Value) -> Result<u64, String> {
    let transaction: Transaction =
        serde_json::from_value(json!({"sequence":sequence,"operations":operations})).unwrap();
    scene.commit(transaction)
}
fn mount(values: Value) -> Value {
    json!([{"kind":"mount","handle":{"id":1,"generation":1},"template":"tags","values":values}])
}
fn snapshot(scene: &Scene) -> Value {
    serde_json::to_value(scene.snapshot()).unwrap()
}

#[test]
fn nested_spans_form_one_paragraph_and_updates_preserve_other_groups() {
    let mut scene = Scene::default();
    install(
        &mut scene,
        json!([
            {"kind":"element","tag":"div","parent":null,"text":""},
            {"kind":"element","tag":"p","parent":0,"text":""},
            {"kind":"text","parent":1,"text":"Count: "},
            {"kind":"element","tag":"span","parent":1,"text":""},
            {"kind":"element","tag":"span","parent":3,"text":""},
            {"kind":"text","parent":4,"text":""},
            {"kind":"element","tag":"p","parent":0,"text":""},
            {"kind":"text","parent":6,"text":"静的🙂"},
            {"kind":"element","tag":"button","parent":0,"text":""},
            {"kind":"text","parent":8,"text":"Increment"}
        ]),
        json!([{"node":5,"type":"text"}]),
        json!([{"node":8,"type":"click"}]),
    )
    .unwrap();
    apply(&mut scene, 1, mount(json!([{"slot":0,"value":"0"}]))).unwrap();
    let before = snapshot(&scene);
    let groups = &before["instances"][0]["text_groups"];
    assert_eq!(
        groups,
        &json!([
            {"text":"Count: 0","revision":1}, {"text":"静的🙂","revision":1}, {"text":"Increment","revision":1}
        ])
    );
    assert_eq!(
        before["instances"][0]["presentation"],
        json!([
            {"kind":"container","source":0,"parent":null,"group":null},
            {"kind":"paragraph","source":1,"parent":0,"group":0},
            {"kind":"paragraph","source":6,"parent":0,"group":1},
            {"kind":"button","source":8,"parent":0,"group":2}
        ])
    );
    apply(
        &mut scene,
        2,
        json!([
            {"kind":"update","handle":{"id":1,"generation":1},"values":[{"slot":0,"value":"1"}]},
            {"kind":"update","handle":{"id":1,"generation":1},"values":[{"slot":0,"value":"2"}]}
        ]),
    )
    .unwrap();
    let after = snapshot(&scene);
    assert_eq!(
        after["instances"][0]["presentation"],
        before["instances"][0]["presentation"]
    );
    assert_eq!(
        after["instances"][0]["text_groups"],
        json!([
            {"text":"Count: 2","revision":2}, {"text":"静的🙂","revision":1}, {"text":"Increment","revision":1}
        ])
    );
    // A transient write restored in the same atomic transaction changes no group revision.
    apply(
        &mut scene,
        3,
        json!([
            {"kind":"update","handle":{"id":1,"generation":1},"values":[{"slot":0,"value":"3"}]},
            {"kind":"update","handle":{"id":1,"generation":1},"values":[{"slot":0,"value":"2"}]}
        ]),
    )
    .unwrap();
    assert_eq!(
        snapshot(&scene)["instances"][0]["text_groups"],
        after["instances"][0]["text_groups"]
    );
}

#[test]
fn mixed_flow_creates_anonymous_paragraphs_in_authored_order() {
    let mut scene = Scene::default();
    install(
        &mut scene,
        json!([
            {"kind":"element","tag":"div","parent":null,"text":""},
            {"kind":"text","parent":0,"text":"one"},
            {"kind":"element","tag":"span","parent":0,"text":""},
            {"kind":"text","parent":2,"text":" two"},
            {"kind":"element","tag":"p","parent":0,"text":""},
            {"kind":"text","parent":4,"text":"three"},
            {"kind":"text","parent":0,"text":" four"}
        ]),
        json!([]),
        json!([]),
    )
    .unwrap();
    apply(&mut scene, 1, mount(json!([]))).unwrap();
    let result = snapshot(&scene);
    assert_eq!(
        result["instances"][0]["text_groups"],
        json!([
            {"text":"one two","revision":1}, {"text":"three","revision":1}, {"text":" four","revision":1}
        ])
    );
    assert_eq!(
        result["instances"][0]["presentation"]
            .as_array()
            .unwrap()
            .len(),
        4
    );
}

#[test]
fn invalid_tag_and_content_contracts_never_install_a_partial_template() {
    let mut scene = Scene::default();
    let error = install(
        &mut scene,
        json!([
            {"kind":"element","tag":"img","parent":null,"text":""}
        ]),
        json!([]),
        json!([]),
    )
    .unwrap_err();
    assert!(error.contains("Unsupported desktop tag <img>"));
    assert!(apply(&mut scene, 1, mount(json!([]))).is_err());
    for (parent, child) in [("p", "div"), ("span", "p"), ("button", "button")] {
        let error = install(
            &mut scene,
            json!([
                {"kind":"element","tag":parent,"parent":null,"text":""},
                {"kind":"element","tag":child,"parent":0,"text":""}
            ]),
            json!([]),
            json!([]),
        )
        .unwrap_err();
        assert!(error.contains("accepts phrasing content"));
    }
    assert!(
        install(
            &mut scene,
            json!([
                {"kind":"text","parent":null,"text":"leaf"},
                {"kind":"text","parent":0,"text":"child"}
            ]),
            json!([]),
            json!([])
        )
        .unwrap_err()
        .contains("cannot contain children")
    );
    assert!(
        install(
            &mut scene,
            json!([
                {"kind":"element","tag":"p","parent":null,"text":""}
            ]),
            json!([]),
            json!([{"node":0,"type":"click"}])
        )
        .unwrap_err()
        .contains("onClick requires a supported control")
    );
    // Correcting the same template identity works after every rejected definition.
    install(
        &mut scene,
        json!([
            {"kind":"element","tag":"p","parent":null,"text":""},
            {"kind":"text","parent":0,"text":"Valid"}
        ]),
        json!([]),
        json!([]),
    )
    .unwrap();
    apply(&mut scene, 1, mount(json!([]))).unwrap();
    assert_eq!(
        snapshot(&scene)["instances"][0]["text_groups"][0]["text"],
        "Valid"
    );
}

#[test]
fn inline_root_and_prototype_aliases_have_defined_flow() {
    for (root, child) in [("span", "span"), ("container", "text")] {
        let mut scene = Scene::default();
        install(
            &mut scene,
            json!([
                {"kind":"element","tag":root,"parent":null,"text":""},
                {"kind":"element","tag":child,"parent":0,"text":""},
                {"kind":"text","parent":1,"text":"hello"}
            ]),
            json!([]),
            json!([]),
        )
        .unwrap();
        apply(&mut scene, 1, mount(json!([]))).unwrap();
        assert_eq!(
            snapshot(&scene)["instances"][0]["text_groups"][0]["text"],
            "hello"
        );
    }
}
