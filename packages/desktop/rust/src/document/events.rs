//! Forward script-visible events while Blitz retains editing, focus and selection.
use std::collections::HashMap;

use blitz_dom::{Document, EventDriver, EventHandler, NodeId};
use blitz_traits::events::{DomEvent, EventState, UiEvent};

use super::{ControlState, EditorRevision, NativeDocument, NodeRef};
use blitz_traits::events::{BlitzImeEvent, DomEventData};

struct ScriptRouter<'a, F> {
    sources: &'a HashMap<NodeId, NodeRef>,
    capture: F,
    revisions: &'a mut HashMap<NodeId, EditorRevision>,
    skip_first: bool,
}

impl<F: FnMut(Vec<NodeRef>, DomEvent, Option<ControlState>)> EventHandler for ScriptRouter<'_, F> {
    fn handle_event(
        &mut self,
        chain: &[NodeId],
        event: &mut DomEvent,
        doc: &mut dyn Document,
        state: &mut EventState,
    ) {
        if self.skip_first {
            self.skip_first = false;
            return;
        }
        if !matches!(event.name(), "click" | "input" | "keydown" | "keyup") {
            return;
        }
        let path: Vec<_> = chain
            .iter()
            .filter_map(|node| self.sources.get(node).cloned())
            .collect();
        if path.is_empty() {
            return;
        }
        if matches!(event.data, DomEventData::Input(_)) {
            let revision = self.revisions.entry(event.target).or_default();
            revision.revision += 1;
            revision.is_composing = false;
        } else {
            // Native defaults resume only after synchronous JS cancellation.
            state.prevent_default();
        }
        let control = super::input::control_state(&doc.inner(), self.revisions, event.target)
            .or_else(|| match &event.data {
                DomEventData::Input(input) => Some(ControlState {
                    value: input.value.clone(),
                    checked: None,
                    revision: self
                        .revisions
                        .get(&event.target)
                        .map_or(0, |state| state.revision),
                    is_composing: false,
                }),
                _ => None,
            });
        (self.capture)(path, event.clone(), control);
    }
}

impl NativeDocument {
    pub(crate) fn focused_source(&self) -> Option<NodeRef> {
        self.source_nodes
            .get(&self.document.get_focussed_node_id()?)
            .cloned()
    }
    pub(crate) fn capture_events(
        &mut self,
        event: UiEvent,
        capture: impl FnMut(Vec<NodeRef>, DomEvent, Option<ControlState>),
    ) {
        self.attach_shell_provider();
        // Preedit stays local in Blitz. Bump the editor epoch before it runs so
        // any already queued JS value write is stale throughout composition.
        if let UiEvent::Ime(ime) = &event {
            if let Some(node) = self.document.get_focussed_node_id() {
                let composing = match ime {
                    BlitzImeEvent::Preedit(text, _) => !text.is_empty(),
                    BlitzImeEvent::Commit(_) | BlitzImeEvent::Disabled => false,
                    _ => self
                        .editor_revisions
                        .get(&node)
                        .is_some_and(|state| state.is_composing),
                };
                self.advance_editor(node, composing);
            }
        }
        let handler = ScriptRouter {
            sources: &self.source_nodes,
            revisions: &mut self.editor_revisions,
            capture,
            skip_first: false,
        };
        EventDriver::new(&mut self.document, handler).handle_ui_event(event);
    }

    pub(crate) fn resume_event(
        &mut self,
        target: &NodeRef,
        event: DomEvent,
        capture: impl FnMut(Vec<NodeRef>, DomEvent, Option<ControlState>),
    ) {
        // A retired generation or recycled engine node cannot receive a held
        // default. A valid stale decision simply releases its pending record.
        if self.node_id(target).ok() != Some(event.target) {
            return;
        }
        let handler = ScriptRouter {
            sources: &self.source_nodes,
            revisions: &mut self.editor_revisions,
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
        let handler = ScriptRouter {
            sources: &document.source_nodes,
            revisions: &mut document.editor_revisions,
            capture: |path, event, _| captured.push((path, event)),
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
        let mut notifications = Vec::new();
        document.resume_event(&source, captured[0].1.clone(), |_, event, control| {
            assert_eq!(event.name(), "input");
            assert_eq!(control.unwrap().checked, Some(true));
            notifications.push(event);
        });
        assert_eq!(notifications.len(), 1);
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
        document.resume_event(&source, captured[0].1.clone(), |_, _, _| {
            panic!("retired default recaptured")
        });
        assert!(document.document.get_node(container).is_some());
    }
}
