//! Measure the dashboard's real CSS in Blitz. This isolates responsive layout
//! contracts from GPU pixels, font rasterization and platform input.
use super::{attribute, element, template, text};
use blitz_dom::{DocumentConfig, StyleThreading};
use blitz_traits::shell::Viewport;
use memoized_dom_desktop::document::{MountTarget, NativeDocument, Owner};

const DASHBOARD_CSS: &str = include_str!("../../../examples/dashboard/style.css");

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
