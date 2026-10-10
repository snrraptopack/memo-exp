//! Placement and publication contracts for ordinary CSS selectors.
use super::*;
use crate::{Handle, Scene, Template, Transaction};
use serde_json::{Value, json};
use std::sync::Arc;

fn handle(id: u64) -> Handle {
    Handle { id, generation: 1 }
}

fn element(tag: &str, class: &str, parent: Option<usize>) -> Value {
    json!({"kind": "element", "tag": tag, "parent": parent, "text": "",
        "attributes": {"class": class}})
}

fn region(parent: Option<usize>, multiple: bool) -> Value {
    json!({"kind": "region", "parent": parent, "multiple": multiple})
}

fn rule(parts: &[(&str, &str)], property: &str, value: &str) -> Rule {
    Rule {
        selectors: vec![
            parts
                .iter()
                .enumerate()
                .map(|(index, (combinator, class))| Selector {
                    combinator: (index > 0).then(|| combinator.to_string()),
                    selectors: vec![SimpleSelector::Class {
                        name: class.to_string(),
                    }],
                })
                .collect(),
        ],
        declarations: vec![Declaration {
            property: property.into(),
            value: value.into(),
        }],
    }
}

fn install(scene: &mut Scene, id: &str, nodes: Vec<Value>, rules: Vec<Rule>) {
    let template: Template = serde_json::from_value(json!({
        "id": id, "nodes": nodes, "slots": [], "events": [], "stylesheets": rules,
    }))
    .unwrap();
    scene.install(template).unwrap();
}

fn mount(id: u64, template: &str, parent: Option<(u64, usize)>) -> Value {
    let mut operation = json!({"kind": "mount", "handle": handle(id),
        "template": template, "values": []});
    if let Some((owner, node)) = parent {
        operation["attach_to"] = json!({"handle": handle(owner), "node": node});
    }
    operation
}

fn order(ids: &[u64]) -> Value {
    json!({"kind": "order", "handle": handle(1), "node": 1,
        "children": ids.iter().copied().map(handle).collect::<Vec<_>>()})
}

fn transaction(sequence: u64, operations: Vec<Value>) -> Transaction {
    serde_json::from_value(json!({"sequence": sequence, "operations": operations})).unwrap()
}

fn properties(scene: &Scene, id: u64, source: usize) -> Properties {
    scene
        .instances()
        .find(|instance| instance.handle.id == id)
        .unwrap()
        .styles[source]
        .states[0]
        .clone()
}

#[test]
fn selectors_cross_region_only_roots_and_keep_real_sibling_order() {
    let mut scene = Scene::default();
    install(
        &mut scene,
        "parent",
        vec![
            element("main", "page", None),
            element("p", "before", Some(0)),
            region(Some(0), false),
            json!({"kind": "text", "parent": 0, "text": "ignored sibling"}),
            region(Some(0), false),
            element("p", "after", Some(0)),
        ],
        vec![
            rule(&[("", "page"), (" ", "leaf")], "color", "red"),
            rule(&[("", "page"), (">", "leaf")], "padding-left", "11px"),
            rule(&[("", "before"), ("+", "leaf")], "margin-top", "7px"),
            rule(&[("", "leaf"), ("+", "second")], "width", "81px"),
            rule(&[("", "leaf"), ("~", "after")], "width", "92px"),
        ],
    );
    install(&mut scene, "passthrough", vec![region(None, false)], vec![]);
    install(&mut scene, "leaf", vec![element("p", "leaf", None)], vec![]);
    install(
        &mut scene,
        "second",
        vec![element("p", "second", None)],
        vec![],
    );
    scene
        .commit(transaction(
            1,
            vec![
                mount(1, "parent", None),
                mount(2, "passthrough", Some((1, 2))),
                mount(3, "leaf", Some((2, 0))),
                mount(4, "second", Some((1, 4))),
            ],
        ))
        .unwrap();
    assert_eq!(properties(&scene, 3, 0)["color"], "red");
    assert_eq!(properties(&scene, 3, 0)["padding-left"], "11px");
    assert_eq!(properties(&scene, 3, 0)["margin-top"], "7px");
    assert_eq!(properties(&scene, 4, 0)["width"], "81px");
    assert_eq!(properties(&scene, 1, 5)["width"], "92px");

    // Retiring a fragment reconnects the real sibling chain, without leaving a
    // phantom region element or old selector match in the accepted styles.
    scene
        .commit(transaction(
            2,
            vec![json!({"kind": "dispose", "handle": handle(2)})],
        ))
        .unwrap();
    assert!(!properties(&scene, 4, 0).contains_key("width"));
    assert!(!properties(&scene, 1, 5).contains_key("width"));
}

#[test]
fn keyed_reordering_restyles_retained_rows_and_rejections_preserve_cascade() {
    let mut scene = Scene::default();
    install(
        &mut scene,
        "list",
        vec![element("section", "list", None), region(Some(0), true)],
        vec![rule(&[("", "a"), ("+", "b")], "width", "123px")],
    );
    install(&mut scene, "a", vec![element("article", "a", None)], vec![]);
    install(&mut scene, "b", vec![element("article", "b", None)], vec![]);
    scene
        .commit(transaction(
            1,
            vec![
                mount(1, "list", None),
                mount(9, "a", Some((1, 1))),
                mount(2, "b", Some((1, 1))),
                order(&[9, 2]),
            ],
        ))
        .unwrap();
    assert_eq!(properties(&scene, 2, 0)["width"], "123px");
    let before = serde_json::to_value(scene.snapshot()).unwrap();
    let rejected = scene.commit_with(transaction(2, vec![order(&[2, 9])]), |instances| {
        assert!(instances.iter().any(|instance| instance.handle.id == 2
            && !instance.styles[0].states[0].contains_key("width")));
        Err("Adapter refused candidate".into())
    });
    assert!(rejected.is_err());
    assert_eq!(before, serde_json::to_value(scene.snapshot()).unwrap());
    scene.commit(transaction(2, vec![order(&[2, 9])])).unwrap();
    assert!(!properties(&scene, 2, 0).contains_key("width"));
    assert_eq!(
        scene
            .instances()
            .find(|instance| instance.handle.id == 2)
            .unwrap()
            .handle,
        handle(2)
    );
    scene.commit(transaction(3, vec![order(&[9, 2])])).unwrap();
    assert_eq!(properties(&scene, 2, 0)["width"], "123px");
}

#[test]
fn global_sheet_order_is_independent_of_fragments_and_unmounted_definitions() {
    let mut scene = Scene::default();
    let early = vec![rule(&[("", "leaf")], "color", "red")];
    install(
        &mut scene,
        "first",
        vec![element("main", "leaf", None)],
        early.clone(),
    );
    install(
        &mut scene,
        "later",
        vec![element("main", "leaf", None)],
        vec![rule(&[("", "leaf")], "color", "blue")],
    );
    // A generated fragment repeating the first sheet must not move it to the
    // end of the cascade. Registered rules also apply before their owner mounts.
    install(
        &mut scene,
        "repeated",
        vec![element("main", "leaf", None)],
        early,
    );
    scene
        .commit(transaction(1, vec![mount(1, "first", None)]))
        .unwrap();
    assert_eq!(properties(&scene, 1, 0)["color"], "blue");
    let styles = scene.instances().next().unwrap().styles.clone();
    scene.commit(transaction(2, vec![])).unwrap();
    assert!(Arc::ptr_eq(
        &styles,
        &scene.instances().next().unwrap().styles
    ));

    install(
        &mut scene,
        "new-sheet",
        vec![element("main", "unused", None)],
        vec![rule(&[("", "leaf")], "color", "green")],
    );
    // Installation registers styles; publication is still an atomic commit.
    assert_eq!(properties(&scene, 1, 0)["color"], "blue");
    assert!(
        scene
            .commit_with(transaction(3, vec![]), |_| Err("reject".into()))
            .is_err()
    );
    assert_eq!(properties(&scene, 1, 0)["color"], "blue");
    scene.commit(transaction(3, vec![])).unwrap();
    assert_eq!(properties(&scene, 1, 0)["color"], "green");
}

#[test]
fn scoped_rules_inline_important_and_target_states_keep_their_cascade() {
    let mut scene = Scene::default();
    let mut scoped = rule(&[("", "page"), (" ", "leaf")], "color", "green");
    scoped.selectors[0][1]
        .selectors
        .push(SimpleSelector::Scope {
            name: "scope-a".into(),
        });
    let mut hover = rule(&[("", "page"), (" ", "leaf")], "width", "30px");
    hover.selectors[0][1].selectors.push(SimpleSelector::State {
        name: "hover".into(),
    });
    install(
        &mut scene,
        "parent",
        vec![element("main", "page", None), region(Some(0), true)],
        vec![
            rule(&[("", "leaf")], "color", "red"),
            scoped,
            hover,
            rule(
                &[("", "page"), (" ", "leaf")],
                "padding-left",
                "9px !important",
            ),
        ],
    );
    let mut leaf = element("button", "leaf scope-a", None);
    leaf["style"] = json!([{"property": "padding-left", "value": "2px"},
        {"property": "width", "value": "17px"}]);
    install(&mut scene, "scoped", vec![leaf], vec![]);
    install(
        &mut scene,
        "unscoped",
        vec![element("button", "leaf", None)],
        vec![],
    );
    let ordered =
        json!({"kind":"order", "handle":handle(1), "node":1,"children":[handle(2),handle(3)]});
    scene
        .commit(transaction(
            1,
            vec![
                mount(1, "parent", None),
                mount(2, "scoped", Some((1, 1))),
                mount(3, "unscoped", Some((1, 1))),
                ordered,
            ],
        ))
        .unwrap();
    assert_eq!(properties(&scene, 2, 0)["color"], "green");
    assert_eq!(properties(&scene, 3, 0)["color"], "red");
    assert_eq!(properties(&scene, 2, 0)["padding-left"], "9px");
    let plain = scene
        .instances()
        .find(|instance| instance.handle.id == 3)
        .unwrap();
    assert!(!plain.styles[0].states[0].contains_key("width"));
    assert_eq!(plain.styles[0].states[1]["width"], "30px");
    // Inline styles still win over a more specific target-state rule.
    let scoped = scene
        .instances()
        .find(|instance| instance.handle.id == 2)
        .unwrap();
    assert_eq!(scoped.styles[0].states[1]["width"], "17px");
}

#[test]
fn stylesheet_identity_deduplicates_fragments_without_merging_distinct_sources() {
    let mut scene = Scene::default();
    let template = |id: &str, sheet: &str, color: &str| -> Template {
        serde_json::from_value(json!({"id":id, "stylesheet":sheet,
            "nodes":[element("main", "leaf", None)], "slots":[], "events":[],
            "stylesheets":[rule(&[("", "leaf")], "color", color)]}))
        .unwrap()
    };
    scene.install(template("a", "a.css", "red")).unwrap();
    scene.install(template("b", "b.css", "blue")).unwrap();
    scene
        .install(template("a-fragment", "a.css", "red"))
        .unwrap();
    scene
        .commit(transaction(1, vec![mount(1, "a", None)]))
        .unwrap();
    assert_eq!(properties(&scene, 1, 0)["color"], "blue");

    // Same contents from a separate source remain a separate later sheet.
    scene.install(template("c", "c.css", "red")).unwrap();
    scene.commit(transaction(2, vec![])).unwrap();
    assert_eq!(properties(&scene, 1, 0)["color"], "red");
    assert!(
        scene
            .install(template("conflict", "a.css", "green"))
            .is_err()
    );
    scene.commit(transaction(3, vec![])).unwrap();
    assert_eq!(properties(&scene, 1, 0)["color"], "red");
}

#[test]
fn text_updates_share_accepted_cascade_and_skip_rule_matching() {
    let mut scene = Scene::default();
    let template: Template = serde_json::from_value(json!({
        "id":"text", "nodes":[element("p", "leaf", None),
            {"kind":"text","parent":0,"text":""}],
        "slots":[{"node":1,"type":"text"}], "events":[],
        "stylesheets":[rule(&[("", "leaf")], "color", "red")]
    }))
    .unwrap();
    scene.install(template).unwrap();
    scene
        .commit(transaction(
            1,
            vec![json!({"kind":"mount","handle":handle(1),
        "template":"text","values":[{"slot":0,"value":"Before"}]})],
        ))
        .unwrap();
    let accepted = scene.instances().next().unwrap().styles.clone();
    scene
        .commit(transaction(
            2,
            vec![json!({"kind":"update","handle":handle(1),
        "values":[{"slot":0,"value":"After"}]})],
        ))
        .unwrap();
    let instance = scene.instances().next().unwrap();
    assert_eq!(instance.texts[1], "After");
    assert!(Arc::ptr_eq(&accepted, &instance.styles));
}
