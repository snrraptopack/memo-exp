//! Engine dispatch captures script-visible clicks before their native defaults.
use std::collections::HashMap;

use blitz_dom::{Document, EventDriver, EventHandler, NodeId};
use blitz_traits::events::{DomEvent, EventState, UiEvent};

use super::{NativeDocument, NodeRef};

struct ClickRouter<'a, F> {
    sources: &'a HashMap<NodeId, NodeRef>,
    capture: F,
    skip_first: bool,
}

impl<F: FnMut(Vec<NodeRef>, DomEvent)> EventHandler for ClickRouter<'_, F> {
    fn handle_event(
        &mut self,
        chain: &[NodeId],
        event: &mut DomEvent,
        _: &mut dyn Document,
        state: &mut EventState,
    ) {
        if self.skip_first {
            self.skip_first = false;
            return;
        }
        if event.name() != "click" {
            return;
        }
        let path: Vec<_> = chain
            .iter()
            .filter_map(|node| self.sources.get(node).cloned())
            .collect();
        if path.is_empty() {
            return;
        }
        state.prevent_default();
        (self.capture)(path, event.clone());
    }
}

impl NativeDocument {
    pub(crate) fn capture_clicks(
        &mut self,
        event: UiEvent,
        capture: impl FnMut(Vec<NodeRef>, DomEvent),
    ) {
        self.attach_shell_provider();
        let handler = ClickRouter {
            sources: &self.source_nodes,
            capture,
            skip_first: false,
        };
        EventDriver::new(&mut self.document, handler).handle_ui_event(event);
    }

    pub(crate) fn resume_click(
        &mut self,
        target: &NodeRef,
        event: DomEvent,
        capture: impl FnMut(Vec<NodeRef>, DomEvent),
    ) {
        // A retired generation or recycled engine node cannot receive a held
        // default. A valid stale decision simply releases its pending record.
        if self.node_id(target).ok() != Some(event.target) {
            return;
        }
        let handler = ClickRouter {
            sources: &self.source_nodes,
            capture,
            skip_first: true,
        };
        EventDriver::new(&mut self.document, handler).handle_dom_event(event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::{
        MountTarget, Owner, SourceNode, Template, TemplateNode, ValidatedTemplate, html_name,
    };
    use blitz_dom::{Attribute, DocumentConfig, QualName, ns};
    use blitz_traits::events::{
        BlitzPointerEvent, BlitzPointerId, DomEventData, MouseEventButton, MouseEventButtons,
        Point, PointerCoords, PointerDetails,
    };

    pub(crate) fn click(target: NodeId) -> DomEvent {
        DomEvent::new(
            target,
            DomEventData::Click(BlitzPointerEvent {
                id: BlitzPointerId::Mouse,
                is_primary: true,
                coords: PointerCoords {
                    page_x: 0.0,
                    page_y: 0.0,
                    screen_x: 0.0,
                    screen_y: 0.0,
                    client_x: 0.0,
                    client_y: 0.0,
                },
                button: MouseEventButton::Main,
                buttons: MouseEventButtons::default(),
                mods: Default::default(),
                details: PointerDetails::default(),
                element: Point::default(),
                active_pointers: Default::default(),
            }),
        )
    }

    #[test]
    fn capture_defers_a_real_blitz_checkbox_default_and_retirement_invalidates_it() {
        let mut document = NativeDocument::new(DocumentConfig::default());
        document.configure_mount("fixture");
        let container = document.mount_parent();
        let template = ValidatedTemplate::new(Template {
            key: "checkbox".to_string(),
            nodes: vec![TemplateNode {
                parent: None,
                node: SourceNode::Element {
                    name: html_name("input"),
                    attributes: vec![Attribute {
                        name: QualName::new(None, ns!(), "type".into()),
                        value: "checkbox".to_string(),
                    }],
                },
            }],
        })
        .unwrap();
        let owner = Owner::new("checkbox", 1);
        document
            .mount(owner.clone(), &template, MountTarget::Body)
            .unwrap();
        let source = owner.node(0);
        let id = document.node_id(&source).unwrap();
        document.resolve(0.0).unwrap();
        assert_eq!(
            document.document.get_node(id).unwrap().parent,
            Some(container)
        );
        let mut captured = Vec::new();
        let handler = ClickRouter {
            sources: &document.source_nodes,
            capture: |path, event| captured.push((path, event)),
            skip_first: false,
        };
        EventDriver::new(&mut document.document, handler).handle_dom_event(click(id));
        assert_eq!(captured.len(), 1);
        assert_eq!(captured[0].0, vec![source.clone()]);
        assert_eq!(
            document
                .document
                .get_node(id)
                .unwrap()
                .element_data()
                .unwrap()
                .checkbox_input_checked(),
            Some(false)
        );
        document.resume_click(&source, captured[0].1.clone(), |_, _| {
            panic!("original click recaptured")
        });
        assert_eq!(
            document
                .document
                .get_node(id)
                .unwrap()
                .element_data()
                .unwrap()
                .checkbox_input_checked(),
            Some(true)
        );
        document.retire(&owner).unwrap();
        assert!(!document.source_nodes.contains_key(&id));
        document.resume_click(&source, captured[0].1.clone(), |_, _| {
            panic!("retired default recaptured")
        });
        assert!(document.document.get_node(container).is_some());
    }
}
