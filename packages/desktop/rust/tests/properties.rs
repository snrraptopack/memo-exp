use memoized_dom_desktop_host::{Node, Scene, Template, Transaction, css};
use serde_json::{Value, json};
use std::sync::Arc;

fn transaction(sequence: u64, operations: Value) -> Transaction {
    serde_json::from_value(json!({ "sequence": sequence, "operations": operations })).unwrap()
}

fn mount(scene: &mut Scene) {
    let template: Template = serde_json::from_value(json!({
        "id": "properties",
        "nodes": [
            { "kind": "element", "tag": "main", "parent": null, "text": "", "attributes": { "id": "before" } },
            { "kind": "element", "tag": "p", "parent": 0, "text": "" },
            { "kind": "text", "parent": 1, "text": "hello" },
            { "kind": "element", "tag": "input", "parent": 0, "text": "" }
        ],
        "slots": [], "events": [],
        "stylesheets": [{
            "selectors": [[
                { "combinator": null, "selectors": [{ "type": "class", "name": "active" }] },
                { "combinator": ">", "selectors": [{ "type": "tag", "name": "p" }] }
            ]],
            "declarations": [{ "property": "color", "value": "red" }]
        }]
    })).unwrap();
    scene.install(template).unwrap();
    scene.commit(transaction(1, json!([{
        "kind": "mount", "handle": { "id": 1, "generation": 1 }, "template": "properties", "values": []
    }]))).unwrap();
}

fn properties(node: usize, attributes: Value, style: Value) -> Value {
    json!({
        "kind": "properties", "handle": { "id": 1, "generation": 1 },
        "properties": [{ "node": node, "attributes": attributes, "style": style }]
    })
}

#[test]
fn replacing_properties_removes_keys_and_restyles_descendants_without_copying_topology() {
    let mut scene = Scene::default();
    mount(&mut scene);
    let template = scene.instances().next().unwrap().template.clone();
    scene
        .commit(transaction(
            2,
            json!([properties(
                0,
                json!({ "class": "active" }),
                json!("padding: 8px 12px")
            )]),
        ))
        .unwrap();
    let instance = scene.instances().next().unwrap();
    assert!(Arc::ptr_eq(&template, &instance.template));
    let Node::Element { attributes, .. } = instance.node(0) else {
        panic!("expected element")
    };
    assert!(!attributes.contains_key("id"));
    assert_eq!(instance.styles[1].states[0]["color"], "red");
    assert_eq!(instance.styles[0].states[0]["padding-right"], "12px");

    scene
        .commit(transaction(3, json!([properties(0, json!({}), json!([]))])))
        .unwrap();
    let instance = scene.instances().next().unwrap();
    assert!(!instance.styles[1].states[0].contains_key("color"));
    assert!(!instance.styles[0].states[0].contains_key("padding-right"));
}

#[test]
fn input_value_updates_keep_the_accepted_cascade_and_paragraph_revision() {
    let mut scene = Scene::default();
    mount(&mut scene);
    let before = scene.instances().next().unwrap();
    let cascade = before.styles.clone();
    let groups = before.text_groups.clone();
    scene
        .commit(transaction(
            2,
            json!([properties(3, json!({ "value": "静🙂" }), json!([]))]),
        ))
        .unwrap();
    let instance = scene.instances().next().unwrap();
    assert_eq!(instance.texts[3], "静🙂");
    assert!(Arc::ptr_eq(&cascade, &instance.styles));
    assert_eq!(
        serde_json::to_value(groups).unwrap(),
        serde_json::to_value(&instance.text_groups).unwrap()
    );
}

#[test]
fn invalid_properties_and_native_style_refusals_preserve_the_entire_scene() {
    let mut scene = Scene::default();
    mount(&mut scene);
    let before = serde_json::to_value(scene.snapshot()).unwrap();
    let invalid = transaction(
        2,
        json!([
            properties(0, json!({ "class": "active" }), json!([])),
            properties(3, json!({ "type": "checkbox" }), json!([]))
        ]),
    );
    assert!(scene.commit(invalid).is_err());
    assert_eq!(before, serde_json::to_value(scene.snapshot()).unwrap());

    let refused = transaction(
        2,
        json!([properties(0, json!({ "class": "active" }), json!([]))]),
    );
    assert!(
        scene
            .commit_with(refused, |_| Err("GPUI refused style".into()))
            .is_err()
    );
    assert_eq!(before, serde_json::to_value(scene.snapshot()).unwrap());
    scene
        .commit(transaction(
            2,
            json!([properties(0, json!({ "class": "active" }), json!([]))]),
        ))
        .unwrap();
    assert_eq!(scene.sequence(), 2);
}

#[test]
fn property_destinations_and_unknown_attributes_are_validated() {
    let mut scene = Scene::default();
    mount(&mut scene);
    for operation in [
        properties(2, json!({ "id": "text" }), json!([])),
        properties(99, json!({}), json!([])),
        properties(0, json!({ "unsupported": "x" }), json!([])),
        properties(0, json!({}), json!("color red")),
    ] {
        assert!(scene.commit(transaction(2, json!([operation]))).is_err());
        assert_eq!(scene.sequence(), 1);
    }
}

#[test]
fn css_strings_use_real_declaration_parsing_including_quotes_and_functions() {
    let declarations =
        css::parse_inline("font-family: 'a;b'; color: rgb(1, 2, 3) !important; padding: 4px 8px;")
            .unwrap();
    assert_eq!(declarations.len(), 3);
    assert_eq!(declarations[0].value, "'a;b'");
    assert_eq!(declarations[1].value, "rgb(1, 2, 3) !important");
    assert!(css::parse_inline("@media screen { color: red }").is_err());
}
