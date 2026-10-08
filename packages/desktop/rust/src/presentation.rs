//! Prepare native flow and paragraph identities once, independently of GPUI frames.
//!
//! Inline spans and adjacent text fragments form a single shaping input. A span
//! is not a flex child. Geometry, styled runs and shaped-line caching follow in
//! the GPUI adapter; this module does not claim to measure or draw text.
use crate::{
    tags::{Layout, Tag},
    template::{Node, Template},
};
use serde::Serialize;
use std::collections::BTreeSet;
use std::sync::Arc;

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind {
    Container,
    Paragraph,
    Button,
}
#[derive(Clone, Debug, Serialize)]
pub struct FlowItem {
    pub kind: ItemKind,
    pub source: usize,
    pub parent: Option<usize>,
    pub group: Option<usize>,
}
#[derive(Debug)]
pub struct TextGroup {
    pub nodes: Vec<usize>,
}
pub struct PresentationPlan {
    pub items: Vec<FlowItem>,
    pub groups: Vec<TextGroup>,
    pub group_for_node: Vec<Option<usize>>,
}

enum Job {
    Element(usize, Option<usize>),
    Text(Vec<usize>, usize, Option<usize>, ItemKind),
}

impl PresentationPlan {
    pub(crate) fn prepare(
        template: &Template,
        tags: &[Option<&Tag>],
        children: &[Vec<usize>],
    ) -> Self {
        let mut plan = Self {
            items: Vec::new(),
            groups: Vec::new(),
            group_for_node: vec![None; template.nodes.len()],
        };
        let mut jobs = vec![Job::Element(0, None)];
        while let Some(job) = jobs.pop() {
            match job {
                Job::Element(node, parent) => match tags[node].map(|tag| tag.layout) {
                    Some(Layout::Block) => {
                        let item = plan.items.len();
                        plan.items.push(FlowItem {
                            kind: ItemKind::Container,
                            source: node,
                            parent,
                            group: None,
                        });
                        let mut sequence = Vec::new();
                        let mut inline = Vec::new();
                        for &child in &children[node] {
                            if tags[child].is_none_or(|tag| tag.layout == Layout::Inline) {
                                inline.push(child);
                            } else {
                                if !inline.is_empty() {
                                    sequence.push(Job::Text(
                                        std::mem::take(&mut inline),
                                        node,
                                        Some(item),
                                        ItemKind::Paragraph,
                                    ));
                                }
                                sequence.push(Job::Element(child, Some(item)));
                            }
                        }
                        if !inline.is_empty() {
                            sequence.push(Job::Text(inline, node, Some(item), ItemKind::Paragraph));
                        }
                        jobs.extend(sequence.into_iter().rev());
                    }
                    Some(Layout::Control) => jobs.push(Job::Text(
                        children[node].clone(),
                        node,
                        parent,
                        ItemKind::Button,
                    )),
                    Some(Layout::Paragraph) => jobs.push(Job::Text(
                        children[node].clone(),
                        node,
                        parent,
                        ItemKind::Paragraph,
                    )),
                    _ => jobs.push(Job::Text(vec![node], node, parent, ItemKind::Paragraph)),
                },
                Job::Text(nodes, source, parent, kind) => {
                    let group = plan.groups.len();
                    let mut fragments = Vec::new();
                    let mut pending = nodes.into_iter().rev().collect::<Vec<_>>();
                    while let Some(node) = pending.pop() {
                        plan.group_for_node[node] = Some(group);
                        if matches!(template.nodes[node], Node::Text { .. }) {
                            fragments.push(node);
                        } else {
                            pending.extend(children[node].iter().rev().copied());
                        }
                    }
                    plan.groups.push(TextGroup { nodes: fragments });
                    plan.items.push(FlowItem {
                        kind,
                        source,
                        parent,
                        group: Some(group),
                    });
                }
            }
        }
        plan
    }

    pub fn values(&self, texts: &[String]) -> Vec<TextValue> {
        self.groups
            .iter()
            .map(|group| TextValue {
                text: self.join(group, texts).into(),
                revision: 1,
            })
            .collect()
    }

    /// Called on staged state before atomic acceptance, never on live state.
    pub fn refresh(&self, texts: &[String], values: &mut [TextValue], pending: &BTreeSet<usize>) {
        for &group in pending {
            let text = self.join(&self.groups[group], texts);
            if values[group].text.as_ref() != text {
                values[group].text = text.into();
                values[group].revision += 1;
            }
        }
    }

    fn join(&self, group: &TextGroup, texts: &[String]) -> String {
        let capacity = group.nodes.iter().map(|&node| texts[node].len()).sum();
        let mut text = String::with_capacity(capacity);
        for &node in &group.nodes {
            text.push_str(&texts[node]);
        }
        text
    }
}

#[derive(Clone, Serialize)]
pub struct TextValue {
    pub text: Arc<str>,
    /// Content revision only. Width/font/DPI changes need separate layout keys.
    pub revision: u64,
}
