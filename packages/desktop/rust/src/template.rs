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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stylesheet: Option<String>,
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
    Region {
        parent: Option<usize>,
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        multiple: bool,
    },
}

impl Node {
    pub fn parent(&self) -> Option<usize> {
        match self {
            Self::Element { parent, .. }
            | Self::Text { parent, .. }
            | Self::Region { parent, .. } => *parent,
        }
    }
    pub fn text(&self) -> &str {
        match self {
            Self::Element {
                tag, attributes, ..
            } if tag == "input" => attributes.get("value").map_or("", String::as_str),
            Self::Element { tag, .. } if tag == "br" => "\n",
            Self::Element { text, .. } | Self::Text { text, .. } => text,
            Self::Region { .. } => "",
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
    Value,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Event {
    pub node: usize,
    pub r#type: EventKind,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum EventKind {
    Click,
    Change,
    KeyDown,
    KeyUp,
    PointerDown,
    PointerUp,
    Focus,
    Blur,
    Submit,
}

pub struct PreparedTemplate {
    pub source: Template,
    pub presentation: PresentationPlan,
    pub styles: Vec<css::CascadedStyle>,
    pub rules: css::PreparedRules,
    pub children: Vec<Vec<usize>>,
}

impl Template {
    /// Resolve and validate all tags before making a template available to mounts.
    pub fn prepare(self) -> Result<PreparedTemplate, String> {
        let invalid = |message: String| format!("Desktop template {}: {message}", self.id);
        if self.id.is_empty() || self.nodes.is_empty() {
            return Err(invalid("Empty scene template".into()));
        }
        if self.stylesheet.as_ref().is_some_and(String::is_empty) {
            return Err(invalid("Empty stylesheet identity".into()));
        }
        let mut resolved = Vec::with_capacity(self.nodes.len());
        let mut children = vec![Vec::new(); self.nodes.len()];
        let mut roots = 0;
        for (index, node) in self.nodes.iter().enumerate() {
            let tag = match node {
                Node::Element {
                    tag,
                    text,
                    attributes,
                    ..
                } => {
                    if tag == "input" && attributes.get("type").is_some_and(|value| value != "text")
                    {
                        return Err(invalid(format!(
                            "node {index}: only input type=text is implemented"
                        )));
                    }
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
                Node::Region { .. } => None,
            };
            match node.parent() {
                None => {
                    // Component roots receive their parent content contract at attachment.
                    roots += 1;
                }
                Some(parent) if parent < index => {
                    let Some(parent_tag): Option<&tags::Tag> = resolved[parent] else {
                        return Err(invalid(format!(
                            "Non-element node {parent} cannot contain children"
                        )));
                    };
                    if matches!(node, Node::Region { .. })
                        && !matches!(
                            parent_tag.content,
                            tags::Content::Flow | tags::Content::List
                        )
                    {
                        return Err(invalid(format!(
                            "Component region at node {index} requires a flow container; <{}> is unsupported",
                            parent_tag.name
                        )));
                    }
                    let list_whitespace = parent_tag.content == tags::Content::List
                        && matches!(node, Node::Text { text, .. } if text.trim().is_empty())
                        && !self.slots.iter().any(|slot| slot.node == index);
                    if !matches!(node, Node::Region { .. })
                        && !list_whitespace
                        && !parent_tag.accepts(tag)
                    {
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
        if roots == 0 {
            return Err(invalid("Template must contain a root".into()));
        }
        let mut slots = BTreeSet::new();
        for slot in &self.slots {
            let valid = match slot.r#type {
                SlotKind::Text => matches!(self.nodes.get(slot.node), Some(Node::Text { .. })),
                SlotKind::Value => {
                    matches!(self.nodes.get(slot.node), Some(Node::Element { tag, .. }) if tag == "input")
                }
            };
            if !valid || !slots.insert(slot.node) {
                return Err(invalid("Invalid or duplicate text slot".into()));
            }
        }
        let mut events = BTreeSet::new();
        for event in &self.events {
            let valid = resolved.get(event.node).is_some_and(|tag| {
                tag.is_some_and(|tag| match event.r#type {
                    EventKind::Click | EventKind::PointerDown | EventKind::PointerUp => {
                        tag.layout != tags::Layout::Inline
                    }
                    EventKind::Change => tag.layout == tags::Layout::Input,
                    EventKind::Submit => tag.name == "form",
                    EventKind::KeyDown | EventKind::KeyUp | EventKind::Focus | EventKind::Blur => {
                        tag.layout != tags::Layout::Inline
                    }
                })
            });
            if !valid || !events.insert((event.node, event.r#type)) {
                return Err(invalid(
                    match event.r#type {
                        EventKind::Click => "Invalid or duplicate control event; onClick requires a supported control",
                        EventKind::Change => "Invalid or duplicate control event; onChange requires an input control",
                        _ => "Invalid or duplicate desktop event",
                    }.into(),
                ));
            }
        }
        let rules = css::PreparedRules::new(&self.stylesheets).map_err(invalid)?;
        let styles = rules.prepare_nodes(&self.nodes).map_err(invalid)?;
        let presentation = PresentationPlan::prepare(&self, &resolved, &children);
        Ok(PreparedTemplate {
            children,
            source: self,
            presentation,
            styles,
            rules,
        })
    }
}
