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
    Input,
    Region,
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
    pub prefix: String,
}
pub struct PresentationPlan {
    pub items: Vec<FlowItem>,
    pub children: Vec<Vec<usize>>,
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
            children: Vec::new(),
            groups: Vec::new(),
            group_for_node: vec![None; template.nodes.len()],
        };
        let mut jobs = template
            .nodes
            .iter()
            .enumerate()
            .rev()
            .filter(|(_, node)| node.parent().is_none())
            .map(|(index, _)| Job::Element(index, None))
            .collect::<Vec<_>>();
        while let Some(job) = jobs.pop() {
            match job {
                Job::Element(node, parent)
                    if matches!(template.nodes[node], Node::Region { .. }) =>
                {
                    plan.items.push(FlowItem {
                        kind: ItemKind::Region,
                        source: node,
                        parent,
                        group: None,
                    });
                }
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
                            if !matches!(template.nodes[child], Node::Region { .. })
                                && tags[child].is_none_or(|tag| tag.layout == Layout::Inline)
                            {
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
                        if tags[node].is_some_and(|tag| tag.name == "li")
                            && !matches!(sequence.first(), Some(Job::Text(..)))
                        {
                            sequence.insert(
                                0,
                                Job::Text(Vec::new(), node, Some(item), ItemKind::Paragraph),
                            );
                        }
                        jobs.extend(sequence.into_iter().rev());
                    }
                    Some(Layout::Input) => plan.items.push(FlowItem {
                        kind: ItemKind::Input,
                        source: node,
                        parent,
                        group: None,
                    }),
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
                        if matches!(&template.nodes[node], Node::Text { .. })
                            || matches!(&template.nodes[node], Node::Element { tag, .. } if tag == "br")
                        {
                            fragments.push(node);
                        } else {
                            pending.extend(children[node].iter().rev().copied());
                        }
                    }
                    let prefix = if tags[source].is_some_and(|tag| tag.name == "li")
                        && !plan
                            .items
                            .iter()
                            .any(|item| item.source == source && item.group.is_some())
                    {
                        let parent = template.nodes[source].parent().unwrap();
                        if tags[parent].is_some_and(|tag| tag.name == "ol") {
                            format!(
                                "{}. ",
                                children[parent]
                                    .iter()
                                    .position(|&child| child == source)
                                    .unwrap()
                                    + 1
                            )
                        } else {
                            "• ".into()
                        }
                    } else {
                        String::new()
                    };
                    plan.groups.push(TextGroup {
                        nodes: fragments,
                        prefix,
                    });
                    plan.items.push(FlowItem {
                        kind,
                        source,
                        parent,
                        group: Some(group),
                    });
                }
            }
        }
        plan.children = vec![Vec::new(); plan.items.len()];
        for (index, item) in plan.items.iter().enumerate() {
            if let Some(parent) = item.parent {
                plan.children[parent].push(index);
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
                runs: self.ranges(group, texts).into(),
            })
            .collect()
    }

    /// Called on staged state before atomic acceptance, never on live state.
    pub fn refresh(&self, texts: &[String], values: &mut [TextValue], pending: &BTreeSet<usize>) {
        for &group in pending {
            let text = self.join(&self.groups[group], texts);
            let runs = self.ranges(&self.groups[group], texts);
            if values[group].text.as_ref() != text || values[group].runs.as_ref() != runs {
                values[group].text = text.into();
                values[group].revision += 1;
                values[group].runs = runs.into();
            }
        }
    }

    fn join(&self, group: &TextGroup, texts: &[String]) -> String {
        let capacity: usize = group.nodes.iter().map(|&node| texts[node].len()).sum();
        let mut text = String::with_capacity(capacity + group.prefix.len());
        text.push_str(&group.prefix);
        for &node in &group.nodes {
            text.push_str(&texts[node]);
        }
        text
    }

    fn ranges(&self, group: &TextGroup, texts: &[String]) -> Vec<TextRange> {
        let mut ranges = Vec::new();
        if !group.prefix.is_empty() {
            ranges.push(TextRange {
                node: None,
                len: group.prefix.len(),
            });
        }
        ranges.extend(
            group
                .nodes
                .iter()
                .filter(|&&node| !texts[node].is_empty())
                .map(|&node| TextRange {
                    node: Some(node),
                    len: texts[node].len(),
                }),
        );
        ranges
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TextRange {
    pub node: Option<usize>,
    pub len: usize,
}

#[derive(Clone, Serialize)]
pub struct TextValue {
    pub text: Arc<str>,
    /// Content revision only. Width/font/DPI changes need separate layout keys.
    pub revision: u64,
    #[serde(skip)]
    pub runs: Arc<[TextRange]>,
}
