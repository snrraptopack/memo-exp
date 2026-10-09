//! Wire definitions and validated, immutable native templates.
use crate::{css, presentation::PresentationPlan, tags};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Template {
    pub id: String,
    pub nodes: Vec<Node>,
    pub slots: Vec<TextSlot>,
    pub events: Vec<Event>,
    #[serde(default)]
    pub stylesheets: Vec<css::Rule>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum Node {
    Element {
        tag: String,
        parent: Option<usize>,
        text: String,
        #[serde(default)]
        attributes: std::collections::BTreeMap<String, String>,
        #[serde(default)]
        style: Vec<css::Declaration>,
    },
    Text {
        parent: Option<usize>,
        text: String,
    },
}

impl Node {
    pub fn parent(&self) -> Option<usize> {
        match self {
            Self::Element { parent, .. } | Self::Text { parent, .. } => *parent,
        }
    }
    pub fn text(&self) -> &str {
        match self {
            Self::Element { tag, .. } if tag == "br" => "\n",
            Self::Element { text, .. } | Self::Text { text, .. } => text,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct TextSlot {
    pub node: usize,
    pub r#type: SlotKind,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SlotKind {
    Text,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub node: usize,
    pub r#type: EventKind,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum EventKind {
    Click,
}

pub struct PreparedTemplate {
    pub source: Template,
    pub presentation: PresentationPlan,
    pub styles: Vec<css::CascadedStyle>,
}

impl Template {
    /// Resolve and validate all tags before making a template available to mounts.
    pub fn prepare(self) -> Result<PreparedTemplate, String> {
        let invalid = |message: String| format!("Desktop template {}: {message}", self.id);
        if self.id.is_empty() || self.nodes.is_empty() {
            return Err(invalid("Empty scene template".into()));
        }
        let mut resolved = Vec::with_capacity(self.nodes.len());
        let mut children = vec![Vec::new(); self.nodes.len()];
        let mut roots = 0;
        for (index, node) in self.nodes.iter().enumerate() {
            let tag = match node {
                Node::Element { tag, text, .. } => {
                    if !text.is_empty() {
                        return Err(invalid(format!(
                            "Element node {index} must store content in text children"
                        )));
                    }
                    Some(
                        tags::resolve(tag)
                            .map_err(|error| invalid(format!("node {index}: {error}")))?,
                    )
                }
                Node::Text { .. } => None,
            };
            match node.parent() {
                None => {
                    if tag.is_some_and(|tag| tag.name == "li") {
                        return Err(invalid("<li> requires an <ul> or <ol> parent".into()));
                    }
                    roots += 1;
                }
                Some(parent) if parent < index => {
                    let Some(parent_tag): Option<&tags::Tag> = resolved[parent] else {
                        return Err(invalid(format!(
                            "Text node {parent} cannot contain children"
                        )));
                    };
                    if !parent_tag.accepts(tag) {
                        return Err(invalid(format!(
                            "<{}> at node {parent} accepts phrasing content; <{}> at node {index} is not supported inside it",
                            parent_tag.name,
                            tag.map_or("text", |tag| tag.name)
                        )));
                    }
                    if tag.is_some_and(|tag| tag.name == "li")
                        && !matches!(parent_tag.name, "ul" | "ol")
                    {
                        return Err(invalid("<li> requires an <ul> or <ol> parent".into()));
                    }
                    children[parent].push(index);
                }
                _ => return Err(invalid("Template parent must precede its child".into())),
            }
            resolved.push(tag);
        }
        if roots != 1 {
            return Err(invalid("Template must contain exactly one root".into()));
        }
        let mut slots = BTreeSet::new();
        for slot in &self.slots {
            if !matches!(self.nodes.get(slot.node), Some(Node::Text { .. }))
                || !slots.insert(slot.node)
            {
                return Err(invalid("Invalid or duplicate text slot".into()));
            }
        }
        let mut events = BTreeSet::new();
        for event in &self.events {
            if !resolved
                .get(event.node)
                .is_some_and(|tag| tag.is_some_and(|tag| tag.click))
                || !events.insert(event.node)
            {
                return Err(invalid(
                    "Invalid or duplicate click event; onClick requires a supported control".into(),
                ));
            }
        }
        let styles = css::prepare(&self.nodes, &self.stylesheets).map_err(invalid)?;
        let presentation = PresentationPlan::prepare(&self, &resolved, &children);
        Ok(PreparedTemplate {
            source: self,
            presentation,
            styles,
        })
    }
}
