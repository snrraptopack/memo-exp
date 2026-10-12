use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use blitz_dom::{Attribute, DocumentConfig, NodeData, QualName, StyleThreading, local_name, ns};
use blitz_traits::shell::{ShellProvider, Viewport};
use memoized_dom_desktop::document::{
    DocumentError, MountTarget, Mutation, NativeDocument, Owner, SourceNode, Template,
    TemplateNode, ValidatedTemplate, html_name,
};

#[derive(Default)]
struct RecordingShell {
    redraws: AtomicUsize,
}

impl ShellProvider for RecordingShell {
    fn request_redraw(&self) {
        self.redraws.fetch_add(1, Ordering::SeqCst);
    }
}

fn host() -> (NativeDocument, Arc<RecordingShell>) {
    let shell = Arc::new(RecordingShell::default());
    let host = NativeDocument::new(DocumentConfig {
        viewport: Some(Viewport {
            window_size: (800, 600),
            ..Viewport::default()
        }),
        shell_provider: Some(shell.clone()),
        // Avoid Stylo's shared parallel traversal pool across Rust test threads.
        style_threading: StyleThreading::Sequential,
        ..DocumentConfig::default()
    });
    shell.redraws.store(0, Ordering::SeqCst);
    (host, shell)
}

fn attribute(name: &str, value: &str) -> Attribute {
    Attribute {
        name: QualName::new(None, ns!(), name.into()),
        value: value.to_string(),
    }
}

fn element(tag: &str, attributes: Vec<Attribute>, parent: Option<u32>) -> TemplateNode {
    TemplateNode {
        parent,
        node: SourceNode::Element {
            name: html_name(tag),
            attributes,
        },
    }
}

fn text(value: &str, parent: Option<u32>) -> TemplateNode {
    TemplateNode {
        parent,
        node: SourceNode::Text(value.to_string()),
    }
}

fn comment(parent: Option<u32>) -> TemplateNode {
    TemplateNode {
        parent,
        node: SourceNode::Comment("region:end".to_string()),
    }
}

fn template(nodes: Vec<TemplateNode>) -> ValidatedTemplate {
    ValidatedTemplate::new(Template {
        key: "fixture".to_string(),
        nodes,
    })
    .unwrap()
}

fn text_at(host: &NativeDocument, owner: &Owner, source: u32) -> String {
    host.engine()
        .get_node(host.node_id(&owner.node(source)).unwrap())
        .unwrap()
        .text_content()
}

fn body_text(host: &NativeDocument) -> String {
    host.engine().get_node(host.body()).unwrap().text_content()
}

#[test]
fn rejects_forward_cyclic_and_non_element_template_parents() {
    for nodes in [
        vec![text("self", Some(0))],
        vec![text("forward", Some(1)), element("div", vec![], None)],
        vec![text("parent", None), text("child", Some(0))],
        vec![comment(None), text("child", Some(0))],
    ] {
        assert!(matches!(
            ValidatedTemplate::new(Template {
                key: "bad".to_string(),
                nodes
            }),
            Err(DocumentError::InvalidTemplate { .. })
        ));
    }
}

#[test]
fn refuses_invalid_names_and_duplicate_attributes_without_engine_work() {
    for nodes in [
        vec![element("bad tag", vec![], None)],
        vec![element("div", vec![attribute("bad attr", "value")], None)],
        vec![element(
            "div",
            vec![attribute("class", "a"), attribute("class", "b")],
            None,
        )],
    ] {
        assert!(matches!(
            ValidatedTemplate::new(Template {
                key: "bad".to_string(),
                nodes
            }),
            Err(DocumentError::InvalidTemplate { .. })
        ));
    }
    assert!(
        ValidatedTemplate::new(Template {
            key: String::new(),
            nodes: vec![]
        })
        .is_err()
    );
}

#[test]
fn mounts_independent_instances_and_preserves_authored_fragment_roots() {
    let (mut host, _) = host();
    let source = template(vec![
        element("p", vec![attribute("class", "label")], None),
        text("first", Some(0)),
        text("tail", None),
    ]);
    let first = Owner::new("App/first", 1);
    let second = Owner::new("App/second", 1);
    host.mount(first.clone(), &source, MountTarget::Body)
        .unwrap();
    host.mount(second.clone(), &source, MountTarget::Body)
        .unwrap();

    let first_root = host.node_id(&first.node(0)).unwrap();
    let second_root = host.node_id(&second.node(0)).unwrap();
    assert_ne!(first_root, second_root);
    assert_eq!(
        host.engine().get_node(first_root).unwrap().parent,
        Some(host.body())
    );
    assert_eq!(
        host.engine()
            .get_node(host.node_id(&first.node(2)).unwrap())
            .unwrap()
            .parent,
        Some(host.body())
    );
    assert_eq!(body_text(&host), "firsttailfirsttail");
    assert_eq!(host.owner_count(), 2);
    assert_eq!(source.key(), "fixture");
    assert_eq!(source.source_count(), 3);
}

#[test]
fn empty_fragments_have_real_boundaries_and_can_move_and_retire() {
    let (mut host, _) = host();
    let empty = Owner::new("empty", 1);
    let label = Owner::new("label", 1);
    host.mount(empty.clone(), &template(vec![]), MountTarget::Body)
        .unwrap();
    host.mount(
        label.clone(),
        &template(vec![text("label", None)]),
        MountTarget::Body,
    )
    .unwrap();
    host.move_to_end(&empty).unwrap();
    host.move_before(&empty, &label).unwrap();
    assert_eq!(body_text(&host), "label");
    host.retire(&empty).unwrap();
    assert_eq!(host.owner_count(), 1);
    host.retire(&label).unwrap();
    assert!(
        host.engine()
            .get_node(host.body())
            .unwrap()
            .children
            .is_empty()
    );
}

#[test]
fn validates_the_complete_write_set_before_changing_any_source() {
    let (mut host, shell) = host();
    let owner = Owner::new("App", 1);
    host.mount(
        owner.clone(),
        &template(vec![
            element("div", vec![attribute("class", "before")], None),
            text("before", Some(0)),
        ]),
        MountTarget::Body,
    )
    .unwrap();
    shell.redraws.store(0, Ordering::SeqCst);

    let result = host.update(&[
        Mutation::Text {
            target: owner.node(1),
            value: "candidate".to_string(),
        },
        Mutation::Attribute {
            target: owner.node(0),
            name: attribute("class", "").name,
            value: Some("candidate".to_string()),
        },
        Mutation::Text {
            target: owner.node(99),
            value: "invalid".to_string(),
        },
    ]);
    assert_eq!(result, Err(DocumentError::UnknownSource));
    assert_eq!(text_at(&host, &owner, 1), "before");
    assert_eq!(
        host.engine()
            .get_node(host.node_id(&owner.node(0)).unwrap())
            .unwrap()
            .data
            .attr(local_name!("class")),
        Some("before")
    );
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
    assert!(!host.is_failed());

    host.update(&[Mutation::Text {
        target: owner.node(1),
        value: "accepted".to_string(),
    }])
    .unwrap();
    assert_eq!(text_at(&host, &owner, 1), "accepted");
}

#[test]
fn text_and_attribute_destinations_require_the_correct_node_kind() {
    let (mut host, shell) = host();
    let owner = Owner::new("App", 1);
    host.mount(
        owner.clone(),
        &template(vec![
            element("div", vec![], None),
            text("text", Some(0)),
            comment(Some(0)),
        ]),
        MountTarget::Body,
    )
    .unwrap();
    shell.redraws.store(0, Ordering::SeqCst);

    for source in [0, 2] {
        assert_eq!(
            host.update(&[Mutation::Text {
                target: owner.node(source),
                value: "wrong".to_string()
            }]),
            Err(DocumentError::WrongNodeKind)
        );
    }
    assert_eq!(
        host.update(&[Mutation::Attribute {
            target: owner.node(1),
            name: attribute("id", "").name,
            value: Some("wrong".to_string())
        }]),
        Err(DocumentError::WrongNodeKind)
    );
    assert_eq!(text_at(&host, &owner, 1), "text");
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
}

#[test]
fn ordinary_attributes_replace_and_remove_without_changing_native_identity() {
    let (mut host, _) = host();
    let owner = Owner::new("App", 1);
    host.mount(
        owner.clone(),
        &template(vec![element(
            "input",
            vec![attribute("value", "before")],
            None,
        )]),
        MountTarget::Body,
    )
    .unwrap();
    let id = host.node_id(&owner.node(0)).unwrap();
    host.update(&[
        Mutation::Attribute {
            target: owner.node(0),
            name: attribute("value", "").name,
            value: Some("after".to_string()),
        },
        Mutation::Attribute {
            target: owner.node(0),
            name: attribute("disabled", "").name,
            value: Some(String::new()),
        },
    ])
    .unwrap();
    assert_eq!(host.node_id(&owner.node(0)).unwrap(), id);
    // Blitz creates the editor during layout construction. A pre-layout write
    // must become its initial text through the ordinary value attribute.
    host.resolve(0.0).unwrap();
    assert_eq!(
        host.engine()
            .get_node(id)
            .unwrap()
            .element_data()
            .unwrap()
            .text_input_data()
            .unwrap()
            .editor
            .text(),
        "after"
    );
    assert_eq!(
        host.engine()
            .get_node(id)
            .unwrap()
            .data
            .attr(local_name!("value")),
        Some("after")
    );
    assert_eq!(
        host.engine()
            .get_node(id)
            .unwrap()
            .data
            .attr(local_name!("disabled")),
        Some("")
    );

    host.update(&[
        Mutation::Attribute {
            target: owner.node(0),
            name: attribute("disabled", "").name,
            value: None,
        },
        Mutation::Attribute {
            target: owner.node(0),
            name: attribute("value", "").name,
            value: Some("updated editor".to_string()),
        },
    ])
    .unwrap();
    host.resolve(0.0).unwrap();
    assert_eq!(
        host.engine()
            .get_node(id)
            .unwrap()
            .data
            .attr(local_name!("disabled")),
        None
    );
    assert_eq!(
        host.engine()
            .get_node(id)
            .unwrap()
            .element_data()
            .unwrap()
            .text_input_data()
            .unwrap()
            .editor
            .text(),
        "updated editor"
    );
}

#[test]
fn invalid_destinations_do_not_allocate_or_consume_an_owner_generation() {
    let (mut host, shell) = host();
    let parent = Owner::new("parent", 1);
    let child = Owner::new("child", 1);
    let source = template(vec![text("parent", None)]);
    host.mount(parent.clone(), &source, MountTarget::Body)
        .unwrap();
    shell.redraws.store(0, Ordering::SeqCst);
    let before = host
        .engine()
        .get_node(host.body())
        .unwrap()
        .children
        .clone();

    assert_eq!(
        host.mount(child.clone(), &source, MountTarget::Element(parent.node(0))),
        Err(DocumentError::WrongNodeKind)
    );
    assert_eq!(
        host.mount(child.clone(), &source, MountTarget::Region(parent.node(0))),
        Err(DocumentError::WrongNodeKind)
    );
    assert_eq!(
        host.mount(
            child.clone(),
            &source,
            MountTarget::Element(parent.node(99))
        ),
        Err(DocumentError::UnknownSource)
    );
    assert_eq!(
        host.engine().get_node(host.body()).unwrap().children,
        before
    );
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
    assert_eq!(host.owner_count(), 1);
    host.mount(child, &source, MountTarget::Body).unwrap();
    assert_eq!(host.owner_count(), 2);
}

#[test]
fn refuses_duplicate_live_ids_and_stale_generations_after_retirement() {
    let (mut host, shell) = host();
    let first = Owner::new("App", 1);
    let second = Owner::new("App", 2);
    let source = template(vec![text("value", None)]);
    host.mount(first.clone(), &source, MountTarget::Body)
        .unwrap();
    let old_node = host.node_id(&first.node(0)).unwrap();
    shell.redraws.store(0, Ordering::SeqCst);
    assert_eq!(
        host.mount(first.clone(), &source, MountTarget::Body),
        Err(DocumentError::DuplicateOwner)
    );
    assert_eq!(
        host.mount(second.clone(), &source, MountTarget::Body),
        Err(DocumentError::DuplicateOwner)
    );
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);

    host.retire(&first).unwrap();
    assert!(host.engine().get_node(old_node).is_none());
    assert_eq!(
        host.mount(first.clone(), &source, MountTarget::Body),
        Err(DocumentError::StaleGeneration)
    );
    host.mount(second.clone(), &source, MountTarget::Body)
        .unwrap();
    assert_ne!(host.node_id(&second.node(0)).unwrap(), old_node);
    assert_eq!(
        host.update(&[Mutation::Text {
            target: first.node(0),
            value: "stale".to_string()
        }]),
        Err(DocumentError::UnknownOwner)
    );
    assert_eq!(text_at(&host, &second, 0), "value");
}

#[test]
fn owner_identity_requires_a_nonempty_id_and_positive_generation() {
    let (mut host, _) = host();
    let source = template(vec![]);
    for owner in [Owner::new("", 1), Owner::new("App", 0)] {
        assert_eq!(
            host.mount(owner, &source, MountTarget::Body),
            Err(DocumentError::InvalidOwner)
        );
    }
    assert_eq!(host.owner_count(), 0);
}

#[test]
fn moves_multiroot_ranges_without_recreating_sources_or_nested_owners() {
    let (mut host, _) = host();
    let first = Owner::new("first", 1);
    let second = Owner::new("second", 1);
    let nested = Owner::new("nested", 1);
    host.mount(
        first.clone(),
        &template(vec![text("a", None), comment(None), text("b", None)]),
        MountTarget::Body,
    )
    .unwrap();
    host.mount(
        nested.clone(),
        &template(vec![text("child", None)]),
        MountTarget::Region(first.node(1)),
    )
    .unwrap();
    host.mount(
        second.clone(),
        &template(vec![text("c", None), text("d", None)]),
        MountTarget::Body,
    )
    .unwrap();
    let child_id = host.node_id(&nested.node(0)).unwrap();
    let first_id = host.node_id(&first.node(0)).unwrap();

    assert_eq!(body_text(&host), "achildbcd");
    host.move_before(&second, &first).unwrap();
    assert_eq!(body_text(&host), "cdachildb");
    host.move_to_end(&second).unwrap();
    assert_eq!(body_text(&host), "achildbcd");
    host.move_before(&first, &first).unwrap();
    assert_eq!(host.node_id(&nested.node(0)).unwrap(), child_id);
    assert_eq!(host.node_id(&first.node(0)).unwrap(), first_id);
    assert_eq!(host.owner_count(), 3);
}

#[test]
fn region_moves_stay_before_their_end_anchor_and_cannot_cross_destinations() {
    let (mut host, _) = host();
    let parent = Owner::new("parent", 1);
    let first = Owner::new("first", 1);
    let second = Owner::new("second", 1);
    let other = Owner::new("other", 1);
    host.mount(
        parent.clone(),
        &template(vec![comment(None), text("separator", None), comment(None)]),
        MountTarget::Body,
    )
    .unwrap();
    host.mount(
        first.clone(),
        &template(vec![text("a", None)]),
        MountTarget::Region(parent.node(0)),
    )
    .unwrap();
    host.mount(
        second.clone(),
        &template(vec![text("b", None)]),
        MountTarget::Region(parent.node(0)),
    )
    .unwrap();
    host.mount(
        other.clone(),
        &template(vec![text("c", None)]),
        MountTarget::Region(parent.node(2)),
    )
    .unwrap();

    host.move_before(&second, &first).unwrap();
    assert_eq!(body_text(&host), "baseparatorc");
    host.move_to_end(&second).unwrap();
    assert_eq!(body_text(&host), "abseparatorc");
    assert_eq!(
        host.move_before(&first, &other),
        Err(DocumentError::DifferentTarget)
    );
    assert_eq!(body_text(&host), "abseparatorc");
}

#[test]
fn retiring_parent_destroys_nested_element_region_and_empty_fragment_owners() {
    let (mut host, _) = host();
    let parent = Owner::new("parent", 1);
    let element_child = Owner::new("element-child", 1);
    let region_child = Owner::new("region-child", 1);
    let empty = Owner::new("empty", 1);
    host.mount(
        parent.clone(),
        &template(vec![element("section", vec![], None), comment(None)]),
        MountTarget::Body,
    )
    .unwrap();
    host.mount(
        element_child.clone(),
        &template(vec![text("inside", None)]),
        MountTarget::Element(parent.node(0)),
    )
    .unwrap();
    host.mount(
        region_child.clone(),
        &template(vec![text("region", None)]),
        MountTarget::Region(parent.node(1)),
    )
    .unwrap();
    host.mount(
        empty.clone(),
        &template(vec![]),
        MountTarget::Region(parent.node(1)),
    )
    .unwrap();
    let ids = [
        host.node_id(&parent.node(0)).unwrap(),
        host.node_id(&parent.node(1)).unwrap(),
        host.node_id(&element_child.node(0)).unwrap(),
        host.node_id(&region_child.node(0)).unwrap(),
    ];

    host.retire(&parent).unwrap();
    assert_eq!(host.owner_count(), 0);
    assert!(
        host.engine()
            .get_node(host.body())
            .unwrap()
            .children
            .is_empty()
    );
    for id in ids {
        assert!(host.engine().get_node(id).is_none());
    }
    assert_eq!(
        host.node_id(&element_child.node(0)),
        Err(DocumentError::UnknownOwner)
    );
    assert_eq!(host.retire(&empty), Err(DocumentError::UnknownOwner));
    assert_eq!(
        host.mount(
            Owner::new("region-child", 1),
            &template(vec![]),
            MountTarget::Body
        ),
        Err(DocumentError::StaleGeneration)
    );
}

#[test]
fn qualified_names_and_namespaced_attributes_reach_the_engine_unchanged() {
    let (mut host, _) = host();
    let owner = Owner::new("svg", 1);
    let name = QualName::new(None, ns!(svg), "linearGradient".into());
    let link = QualName::new(Some("xlink".into()), ns!(xlink), "href".into());
    let source = template(vec![TemplateNode {
        parent: None,
        node: SourceNode::Element {
            name: name.clone(),
            attributes: vec![Attribute {
                name: link.clone(),
                value: "#paint".to_string(),
            }],
        },
    }]);
    host.mount(owner.clone(), &source, MountTarget::Body)
        .unwrap();
    let node = host
        .engine()
        .get_node(host.node_id(&owner.node(0)).unwrap())
        .unwrap();
    let NodeData::Element(element) = &node.data else {
        panic!("expected an element")
    };
    assert_eq!(element.name, name);
    assert_eq!(element.attrs()[0].name, link);
    assert_eq!(element.attrs()[0].value, "#paint");
}

#[test]
fn raw_css_and_comment_regions_use_blitz_layout_without_an_element_wrapper() {
    let (mut host, _) = host();
    let owner = Owner::new("App", 1);
    let child = Owner::new("row", 1);
    let css = r#"
        body {
            margin: 0;
        }

        :root {
            --box-width: 140px;
        }

        .container {
            display: flex;
            gap: 10px;
            width: 400px;
            height: 120px;
        }

        .box {
            flex: none;
            width: var(--box-width);
            height: 40px;
        }

        .wide {
            width: 200px;
        }
    "#;
    host.mount(
        owner.clone(),
        &template(vec![
            element("style", vec![], None),
            text(css, Some(0)),
            element("main", vec![attribute("class", "container")], None),
            element("div", vec![attribute("class", "box")], Some(2)),
            text("one", Some(3)),
            comment(Some(2)),
        ]),
        MountTarget::Body,
    )
    .unwrap();
    host.mount(
        child.clone(),
        &template(vec![
            element("div", vec![attribute("class", "box")], None),
            text("two", Some(0)),
        ]),
        MountTarget::Region(owner.node(5)),
    )
    .unwrap();
    let first_id = host.node_id(&owner.node(3)).unwrap();
    let second_id = host.node_id(&child.node(0)).unwrap();

    host.resolve(0.0).unwrap();
    assert_eq!(
        host.engine()
            .get_node(first_id)
            .unwrap()
            .final_layout()
            .size
            .width,
        140.0
    );
    assert_eq!(
        host.engine()
            .get_node(second_id)
            .unwrap()
            .final_layout()
            .location
            .x,
        150.0
    );

    host.update(&[Mutation::Attribute {
        target: owner.node(3),
        name: attribute("class", "").name,
        value: Some("box wide".to_string()),
    }])
    .unwrap();
    host.resolve(0.0).unwrap();
    assert_eq!(
        host.engine()
            .get_node(first_id)
            .unwrap()
            .final_layout()
            .size
            .width,
        200.0
    );
    assert_eq!(
        host.engine()
            .get_node(second_id)
            .unwrap()
            .final_layout()
            .location
            .x,
        210.0
    );

    host.update(&[Mutation::Text {
        target: owner.node(1),
        value: css.replace("140px", "120px"),
    }])
    .unwrap();
    host.resolve(0.0).unwrap();
    assert_eq!(
        host.engine()
            .get_node(second_id)
            .unwrap()
            .final_layout()
            .size
            .width,
        120.0
    );
    assert_eq!(host.node_id(&child.node(0)).unwrap(), second_id);
}

#[test]
fn retirement_clears_only_destroyed_ranges_and_keeps_other_sources_usable() {
    let (mut host, _) = host();
    let source = template(vec![text("before", None)]);
    let removed = Owner::new("removed", 1);
    let retained = Owner::new("retained", 1);
    host.mount(removed.clone(), &source, MountTarget::Body)
        .unwrap();
    host.mount(retained.clone(), &source, MountTarget::Body)
        .unwrap();
    let removed_id = host.node_id(&removed.node(0)).unwrap();
    let retained_id = host.node_id(&retained.node(0)).unwrap();

    host.retire(&removed).unwrap();
    assert!(host.engine().get_node(removed_id).is_none());
    assert_eq!(host.owner_count(), 1);
    assert_eq!(host.node_id(&retained.node(0)).unwrap(), retained_id);
    host.update(&[Mutation::Text {
        target: retained.node(0),
        value: "after".to_string(),
    }])
    .unwrap();
    host.move_to_end(&retained).unwrap();
    assert_eq!(
        host.engine().get_node(retained_id).unwrap().text_content(),
        "after"
    );
    host.retire(&retained).unwrap();
    assert_eq!(host.owner_count(), 0);
    assert!(
        host.engine()
            .get_node(host.body())
            .unwrap()
            .children
            .is_empty()
    );
}
