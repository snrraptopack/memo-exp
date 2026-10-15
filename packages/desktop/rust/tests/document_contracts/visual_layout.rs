//! Measure a fixed dashboard stylesheet in Blitz. Test-owned input keeps these
//! contracts independent from editable demos, GPU pixels and platform input.
use super::{attribute, element, template, text};
use blitz_dom::{DocumentConfig, QualName, StyleThreading, ns};
use blitz_traits::shell::Viewport;
use memoized_dom_desktop::document::{
    MountTarget, Mutation, NativeDocument, Owner, SourceNode, TemplateNode,
};

const DASHBOARD_CSS: &str = include_str!("fixtures/dashboard.css");

#[test]
fn inline_svg_resolves_into_a_native_vector_tree_and_rebuilds_after_writes() {
    let (mut document, _) = super::host();
    let owner = Owner::new("vector-fixture", 1);
    let svg = |tag: &str, attributes, parent| TemplateNode {
        parent,
        node: SourceNode::Element {
            name: QualName::new(None, ns!(svg), tag.into()),
            attributes,
        },
    };
    let source = template(vec![
        svg(
            "svg",
            vec![
                attribute("xmlns", "http://www.w3.org/2000/svg"),
                attribute("width", "320"),
                attribute("height", "120"),
                attribute("viewBox", "0 0 320 120"),
            ],
            None,
        ),
        svg(
            "path",
            vec![
                attribute("id", "activity-curve"),
                attribute("d", "M 10 60 C 90 10 180 110 310 60"),
                attribute("fill", "none"),
                attribute("stroke", "#9676ce"),
                attribute("stroke-width", "3"),
            ],
            Some(0),
        ),
        svg(
            "circle",
            vec![
                attribute("id", "activity-dot"),
                attribute("cx", "160"),
                attribute("cy", "60"),
                attribute("r", "12"),
                attribute("fill", "#ab91d7"),
            ],
            Some(0),
        ),
    ]);
    document
        .mount(owner.clone(), &source, MountTarget::Body)
        .unwrap();
    document.resolve(0.0).unwrap();
    let id = document.node_id(&owner.node(0)).unwrap();
    {
        let element = document
            .engine()
            .get_node(id)
            .unwrap()
            .element_data()
            .unwrap();
        let vector = element
            .svg_data()
            .expect("inline SVG must become native vector data");
        assert_eq!(vector.size().width(), 320.0);
        assert_eq!(vector.size().height(), 120.0);
        assert!(vector.node_by_id("activity-curve").is_some());
        assert!(vector.node_by_id("activity-dot").is_some());
    }
    document
        .update(&[Mutation::Attribute {
            target: owner.node(0),
            name: QualName::new(None, ns!(), "width".into()),
            value: Some("640".to_string()),
        }])
        .unwrap();
    document.resolve(0.0).unwrap();
    assert_eq!(document.node_id(&owner.node(0)).unwrap(), id);
    assert_eq!(document.engine().get_node(id).unwrap().children.len(), 2);
    assert!(
        document
            .engine()
            .get_node(document.node_id(&owner.node(1)).unwrap())
            .is_some()
    );
    assert!(
        document
            .engine()
            .get_node(document.node_id(&owner.node(2)).unwrap())
            .is_some()
    );
    let vector = document
        .engine()
        .get_node(id)
        .unwrap()
        .element_data()
        .unwrap()
        .svg_data()
        .unwrap();
    assert_eq!(vector.size().width(), 640.0);
    assert!(vector.node_by_id("activity-curve").is_some());
    assert!(vector.node_by_id("activity-dot").is_some());
}

#[test]
fn dashboard_css_reflows_sidebar_cards_and_shapes_at_its_breakpoints() {
    for (width, sidebar_width, cards_in_first_row) in
        [(1280, 220.0, 3), (900, 180.0, 2), (600, 600.0, 1)]
    {
        let mut document = NativeDocument::new(DocumentConfig {
            viewport: Some(Viewport {
                window_size: (width, 900),
                ..Viewport::default()
            }),
            style_threading: StyleThreading::Sequential,
            ..DocumentConfig::default()
        });
        let owner = Owner::new("dashboard-layout", 1);
        let source = template(vec![
            element("div", vec![attribute("class", "workspace")], None),
            element("aside", vec![attribute("class", "sidebar")], Some(0)),
            element("main", vec![attribute("class", "dashboard")], Some(0)),
            element("section", vec![attribute("class", "metrics")], Some(2)),
            element("article", vec![attribute("class", "card metric")], Some(3)),
            element("article", vec![attribute("class", "card metric")], Some(3)),
            element(
                "article",
                vec![attribute("class", "card metric accent-card")],
                Some(3),
            ),
            element("div", vec![attribute("class", "shape-grid")], Some(2)),
            element("div", vec![attribute("class", "specimen")], Some(7)),
            element("div", vec![attribute("class", "shape ring")], Some(8)),
            element("style", vec![], None),
            text(DASHBOARD_CSS, Some(10)),
        ]);
        document
            .mount(owner.clone(), &source, MountTarget::Body)
            .unwrap();
        document.resolve(0.0).unwrap();
        let rect = |source| {
            document
                .engine()
                .get_client_bounding_rect(document.node_id(&owner.node(source)).unwrap())
                .unwrap()
        };
        let sidebar = rect(1);
        assert!(
            (sidebar.width - sidebar_width).abs() < 0.1,
            "sidebar at {width}: {sidebar:?}"
        );
        let cards = [rect(4), rect(5), rect(6)];
        for (index, card) in cards.iter().enumerate() {
            assert!(
                card.width > 0.0 && card.height >= 150.0,
                "card at {width}: {card:?}"
            );
            if index < cards_in_first_row {
                assert!((card.y - cards[0].y).abs() < 0.1, "first row at {width}");
            } else {
                assert!(card.y > cards[0].y, "wrapped row at {width}");
            }
        }
        let ring = rect(9);
        assert!((ring.width - 52.0).abs() < 0.1 && (ring.height - 52.0).abs() < 0.1);
        // Layout dimensions verify the border-box contract, not painted edges.
        if width == 600 {
            assert!(rect(2).y >= sidebar.y + sidebar.height - 0.1);
        } else {
            assert!(rect(2).x >= sidebar.x + sidebar.width - 0.1);
        }
    }
}
