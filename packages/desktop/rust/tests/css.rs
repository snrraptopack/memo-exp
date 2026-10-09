use memoized_dom_desktop_host::{Scene, Template, Transaction, css};
use serde_json::json;

fn template() -> Template {
    serde_json::from_value(json!({"id":"css","nodes":[
        {"kind":"element","tag":"main","parent":null,"text":"","attributes":{"id":"app","class":"card"}},
        {"kind":"element","tag":"p","parent":0,"text":"","attributes":{"class":"accent"},"style":[{"property":"color","value":"green"}]},
        {"kind":"text","parent":1,"text":"静的🙂"},
        {"kind":"element","tag":"p","parent":0,"text":""},
        {"kind":"text","parent":3,"text":"second"}
    ],"slots":[],"events":[],"stylesheets":[
        {"selectors":[[{"combinator":null,"selectors":[{"type":"tag","name":"p"}]}]],"declarations":[{"property":"color","value":"red"},{"property":"margin","value":"1px 2px 3px 4px"}]},
        {"selectors":[[{"combinator":null,"selectors":[{"type":"id","name":"app"}]},{"combinator":">","selectors":[{"type":"class","name":"accent"}]}]],"declarations":[{"property":"color","value":"blue !important"},{"property":"margin-left","value":"8px"}]},
        {"selectors":[[{"combinator":null,"selectors":[{"type":"class","name":"accent"},{"type":"state","name":"hover"}]}]],"declarations":[{"property":"background-color","value":"yellow"}]},
        {"selectors":[[{"combinator":null,"selectors":[{"type":"class","name":"accent"}]},{"combinator":"+","selectors":[{"type":"tag","name":"p"}]}]],"declarations":[{"property":"color","value":"purple"}]}
    ]})).unwrap()
}

#[test]
fn cascade_uses_specificity_important_inline_order_and_real_source_siblings() {
    let prepared = template().prepare().unwrap();
    let p = &prepared.styles[1].states[0];
    assert_eq!(p["color"], "blue"); // stylesheet !important beats inline normal.
    assert_eq!(p["margin-top"], "1px");
    assert_eq!(p["margin-right"], "2px");
    assert_eq!(p["margin-bottom"], "3px");
    assert_eq!(p["margin-left"], "8px");
    assert_eq!(prepared.styles[3].states[0]["color"], "purple"); // skip text siblings.
    assert!(!p.contains_key("background-color"));
    assert_eq!(prepared.styles[1].states[1]["background-color"], "yellow");
    assert!(!prepared.styles[1].states[2].contains_key("background-color"));
    assert_eq!(prepared.styles[1].states[3]["background-color"], "yellow");
}

#[test]
fn shorthand_expansion_preserves_functions_quotes_and_important_comments() {
    assert_eq!(
        css::components("/* comment */ 8px 12px").unwrap(),
        vec!["8px", "12px"]
    );
    assert_eq!(
        css::components("rgb(1, 2, 3) ! /*x*/ IMPORTANT").unwrap(),
        vec!["rgb(1, 2, 3)", "!", "IMPORTANT"]
    );
    let declarations = vec![css::Declaration {
        property: "border".into(),
        value: "2px solid rgb(1, 2, 3)".into(),
    }];
    let expanded = css::expand_declarations(&declarations).unwrap();
    assert_eq!(expanded["border-top-width"], "2px");
    assert_eq!(expanded["border-color"], "rgb(1, 2, 3)");
}

#[test]
fn native_style_rejection_does_not_publish_or_cache_a_partial_template() {
    let mut scene = Scene::default();
    assert!(
        scene
            .install_with(template(), |_| Err("native CSS rejected".into()))
            .is_err()
    );
    let mount:Transaction=serde_json::from_value(json!({"sequence":1,"operations":[{"kind":"mount","handle":{"id":1,"generation":1},"template":"css","values":[]}]})).unwrap();
    assert!(scene.commit(mount).is_err());
    assert_eq!(scene.sequence(), 0);
    scene.install_with(template(), |_| Ok(())).unwrap(); // clean retry.
}

#[test]
fn tag_catalogue_has_explicit_defaults_and_pending_controls_never_become_divs() {
    for tag in memoized_dom_desktop_host::tags::TAGS {
        assert_eq!(
            memoized_dom_desktop_host::tags::resolve(tag.name)
                .unwrap()
                .name,
            tag.name
        );
    }
    for tag in memoized_dom_desktop_host::tags::PENDING {
        assert!(
            memoized_dom_desktop_host::tags::resolve(tag)
                .unwrap_err()
                .contains("native behavior")
        );
    }
    let t: Template = serde_json::from_value(json!({"id":"list","nodes":[
        {"kind":"element","tag":"ol","parent":null,"text":""},
        {"kind":"element","tag":"li","parent":0,"text":""},
        {"kind":"text","parent":1,"text":"first"},
        {"kind":"element","tag":"li","parent":0,"text":""},
        {"kind":"text","parent":3,"text":"second"}
    ],"slots":[],"events":[]}))
    .unwrap();
    let prepared = t.prepare().unwrap();
    let texts = prepared
        .source
        .nodes
        .iter()
        .map(|node| node.text().to_owned())
        .collect::<Vec<_>>();
    let values = prepared.presentation.values(&texts);
    assert_eq!(values[0].text.as_ref(), "1. first");
    assert_eq!(values[1].text.as_ref(), "2. second");
}

#[test]
fn br_and_unicode_run_boundaries_are_utf8_bytes_and_void_content_is_rejected() {
    let mut t: Template = serde_json::from_value(json!({"id":"runs","nodes":[
        {"kind":"element","tag":"p","parent":null,"text":""},
        {"kind":"text","parent":0,"text":"静🙂"},
        {"kind":"element","tag":"br","parent":0,"text":""},
        {"kind":"element","tag":"strong","parent":0,"text":""},
        {"kind":"text","parent":3,"text":"café"}
    ],"slots":[],"events":[]}))
    .unwrap();
    let prepared = t.clone().prepare().unwrap();
    let texts = prepared
        .source
        .nodes
        .iter()
        .map(|node| node.text().to_owned())
        .collect::<Vec<_>>();
    let values = prepared.presentation.values(&texts);
    assert_eq!(values[0].text.as_ref(), "静🙂\ncafé");
    assert_eq!(
        values[0].runs.iter().map(|run| run.len).collect::<Vec<_>>(),
        vec![7, 1, 5]
    );
    t.nodes[4] =
        serde_json::from_value(json!({"kind":"text","parent":2,"text":"invalid"})).unwrap();
    assert!(t.prepare().is_err());
}
