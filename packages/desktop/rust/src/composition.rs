//! Retained text inputs across component and ordered-region boundaries.
//!
//! Local paragraph projections and placed anonymous flow share source walking
//! and candidate value preparation. Neither path introduces reactive ownership.
use crate::{
    Handle, Instance,
    forest::Placements,
    presentation::{TextPath, TextRange, TextSource, TextValue},
    tags::{self, Layout},
    template::Node,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

type GroupIdentity = (u64, u64, usize);

#[derive(Default)]
pub(crate) struct CompositionPlan {
    groups: BTreeMap<GroupIdentity, Vec<Arc<TextPath>>>,
    consumers: BTreeMap<u64, BTreeSet<GroupIdentity>>,
}

impl CompositionPlan {
    pub fn is_empty(&self) -> bool {
        self.groups.is_empty()
    }

    pub fn contains(&self, handle: Handle, group: usize) -> bool {
        self.groups
            .contains_key(&(handle.id, handle.generation, group))
    }

    pub fn prepare(records: &BTreeMap<u64, &Instance>) -> Self {
        let placements = Placements::new(records);
        let mut plan = Self::default();
        for instance in records.values() {
            for item in &instance.template.presentation.items {
                let Some(group_index) = item.group else {
                    continue;
                };
                let group = &instance.template.presentation.groups[group_index];
                if !group.nodes.iter().any(|&node| {
                    matches!(instance.template.source.nodes[node], Node::Region { .. })
                }) {
                    continue;
                }
                let identity = (instance.handle.id, instance.handle.generation, group_index);
                let mut seeds = Vec::new();
                for &node in &group.nodes {
                    // Template grouping flattened these wrappers. Restore their
                    // ancestry up to the paragraph/control before placement.
                    let mut ancestry = Vec::new();
                    let mut parent = instance.template.source.nodes[node].parent();
                    while let Some(source) = parent {
                        if source == item.source {
                            break;
                        }
                        if is_inline(instance, source) {
                            ancestry.push(TextSource {
                                handle: instance.handle,
                                node: source,
                            });
                        }
                        parent = instance.template.source.nodes[source].parent();
                    }
                    ancestry.reverse();
                    seeds.push((
                        TextSource {
                            handle: instance.handle,
                            node,
                        },
                        ancestry,
                    ));
                }
                let fragments = text_paths(&placements, seeds);
                plan.consumers
                    .entry(instance.handle.id)
                    .or_default()
                    .insert(identity);
                for fragment in &fragments {
                    plan.consumers
                        .entry(fragment.source.handle.id)
                        .or_default()
                        .insert(identity);
                }
                plan.groups.insert(identity, fragments);
            }
        }
        plan
    }

    pub fn refresh<'a>(
        &self,
        lookup: impl Fn(u64) -> &'a Instance,
        changed: &BTreeSet<u64>,
        topology_changed: bool,
        mounted: &BTreeSet<u64>,
    ) -> Vec<(Handle, usize, TextValue)> {
        let pending: BTreeSet<_> = if topology_changed {
            self.groups.keys().copied().collect()
        } else {
            changed
                .iter()
                .filter_map(|id| self.consumers.get(id))
                .flat_map(|groups| groups.iter().copied())
                .collect()
        };
        let mut updates = Vec::new();
        for identity @ (id, _, group) in pending {
            let instance = lookup(id);
            let definition = &instance.template.presentation.groups[group];
            let prefix = instance.markers.get(&group).unwrap_or(&definition.prefix);
            if let Some(value) = text_value(
                &lookup,
                &self.groups[&identity],
                prefix,
                &instance.text_groups[group],
                mounted.contains(&id),
            ) {
                updates.push((instance.handle, group, value));
            }
        }
        updates
    }
}

/// Resolve only phrasing descendants; block splitting belongs to placed flow.
/// An explicit stack keeps deep forwarding chains off the native call stack.
pub(crate) fn text_paths(
    placements: &Placements<'_>,
    seeds: Vec<(TextSource, Vec<TextSource>)>,
) -> Vec<Arc<TextPath>> {
    let mut pending: Vec<_> = seeds.into_iter().rev().collect();
    let mut fragments = Vec::new();
    while let Some((source, mut ancestry)) = pending.pop() {
        let owner = placements.records[&source.handle.id];
        match &owner.template.source.nodes[source.node] {
            Node::Region { .. } => {
                pending.extend(
                    placements
                        .expand(vec![source])
                        .into_iter()
                        .rev()
                        .map(|child| (child, ancestry.clone())),
                );
            }
            Node::Text { .. } => fragments.push(Arc::new(TextPath {
                source,
                ancestry: ancestry.into(),
            })),
            Node::Element { tag, .. } if tag == "br" => {
                fragments.push(Arc::new(TextPath {
                    source,
                    ancestry: ancestry.into(),
                }));
            }
            Node::Element { .. } => {
                debug_assert!(is_inline(owner, source.node));
                ancestry.push(source);
                pending.extend(
                    placements
                        .children(source)
                        .into_iter()
                        .rev()
                        .map(|child| (child, ancestry.clone())),
                );
            }
        }
    }
    fragments
}

/// Compare the complete final input before acceptance. Paths are shared across
/// slot edits, and a write restored in one transaction leaves its revision alone.
pub(crate) fn text_value<'a>(
    lookup: impl Fn(u64) -> &'a Instance,
    fragments: &[Arc<TextPath>],
    prefix: &str,
    previous: &TextValue,
    initial: bool,
) -> Option<TextValue> {
    let capacity = prefix.len()
        + fragments
            .iter()
            .map(|fragment| lookup(fragment.source.handle.id).texts[fragment.source.node].len())
            .sum::<usize>();
    let mut text = String::with_capacity(capacity);
    text.push_str(prefix);
    let mut runs = Vec::with_capacity(fragments.len() + usize::from(!prefix.is_empty()));
    if !prefix.is_empty() {
        runs.push(TextRange {
            node: None,
            len: prefix.len(),
            path: None,
        });
    }
    for fragment in fragments {
        let value = &lookup(fragment.source.handle.id).texts[fragment.source.node];
        if value.is_empty() {
            continue;
        }
        text.push_str(value);
        runs.push(TextRange {
            node: Some(fragment.source.node),
            len: value.len(),
            path: Some(fragment.clone()),
        });
    }
    if previous.text.as_ref() == text && previous.runs.as_ref() == runs {
        return None;
    }
    Some(TextValue {
        text: text.into(),
        runs: runs.into(),
        revision: if initial { 1 } else { previous.revision + 1 },
    })
}

fn is_inline(instance: &Instance, node: usize) -> bool {
    matches!(&instance.template.source.nodes[node], Node::Element { tag, .. }
        if tags::resolve(tag).is_ok_and(|tag| tag.layout == Layout::Inline))
}
