//! Native editor synchronization only; application values stay in shared JS cells.
#[cfg(feature = "window")]
use blitz_dom::{BaseDocument, NodeId};
#[cfg(feature = "window")]
use serde::Serialize;
#[cfg(feature = "window")]
use std::collections::HashMap;

#[cfg(feature = "window")]
use super::NativeDocument;

#[derive(Default)]
pub(crate) struct EditorRevision {
    pub revision: u64,
    pub is_composing: bool,
    pub controlled_version: u64,
}

#[cfg(feature = "window")]
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ControlState {
    pub value: String,
    pub revision: u64,
    pub is_composing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub checked: Option<bool>,
}

#[cfg(feature = "window")]
pub(super) fn control_state(
    document: &BaseDocument,
    revisions: &HashMap<NodeId, EditorRevision>,
    node: NodeId,
) -> Option<ControlState> {
    let element = document.get_node(node)?.element_data()?;
    let checked = element.checkbox_input_checked();
    let value = if let Some(input) = element.text_input_data() {
        input.editor.raw_text().to_string()
    } else if checked.is_some() {
        element
            .attrs()
            .iter()
            .find(|attribute| {
                let name: &str = attribute.name.local.as_ref();
                name == "value"
            })
            .map_or_else(|| "on".to_string(), |attribute| attribute.value.clone())
    } else {
        return None;
    };
    let revision = revisions.get(&node);
    Some(ControlState {
        value,
        checked,
        revision: revision.map_or(0, |state| state.revision),
        is_composing: revision.is_some_and(|state| state.is_composing),
    })
}

#[cfg(feature = "window")]
impl NativeDocument {
    pub(crate) fn control_state(&self, node: NodeId) -> Option<ControlState> {
        control_state(&self.document, &self.editor_revisions, node)
    }

    /// Edits and IME preedit invalidate older controlled writes. Composition
    /// stays inside Blitz; a JS render cannot replace the provisional text.
    pub(crate) fn advance_editor(&mut self, node: NodeId, composing: bool) {
        let state = self.editor_revisions.entry(node).or_default();
        state.revision += 1;
        state.is_composing = composing;
    }
}
