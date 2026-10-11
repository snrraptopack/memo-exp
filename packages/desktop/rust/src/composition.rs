//! Retained paragraph inputs across component and ordered-region boundaries.
//!
//! A region contributes authored text and inline styles to its enclosing group.
//! It never introduces a layout box. Plans change only with accepted topology;
//! ordinary slot edits revisit only the groups depending on the changed owner.
use crate::{
    Handle, Instance,
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
    // Paths belong to accepted topology. Slot refreshes share them with runs
    // instead of allocating ancestry lists for every edit or native frame.
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
        let mut plan = Self::default();
        let mut attachments = BTreeMap::<(u64, usize), Vec<u64>>::new();
        for instance in records.values() {
            if let Some(parent) = instance.attach_to {
                attachments
                    .entry((parent.handle.id, parent.node))
                    .or_default()
                    .push(instance.handle.id);
            }
        }
        for instance in records.values() {
            for (&node, order) in &instance.orders {
                attachments.insert(
                    (instance.handle.id, node),
                    order.iter().map(|handle| handle.id).collect(),
                );
            }
        }

        for instance in records.values() {
            for (group_index, group) in instance.template.presentation.groups.iter().enumerate() {
                if !group.nodes.iter().any(|&node| {
                    matches!(instance.template.source.nodes[node], Node::Region { .. })
                }) {
                    continue;
                }
                let identity = (instance.handle.id, instance.handle.generation, group_index);
                let item = instance
                    .template
                    .presentation
                    .items
                    .iter()
                    .find(|item| item.group == Some(group_index))
                    .unwrap();
                let mut pending = Vec::new();
                for &node in group.nodes.iter().rev() {
                    // Local wrappers were flattened by the template planner.
                    // Restore their style ancestry up to the paragraph/control.
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
                    pending.push((instance.handle.id, node, ancestry));
                }

                let mut fragments = Vec::new();
                while let Some((id, node, mut ancestry)) = pending.pop() {
                    let owner = records[&id];
                    plan.consumers.entry(id).or_default().insert(identity);
                    let source = TextSource {
                        handle: owner.handle,
                        node,
                    };
                    match &owner.template.source.nodes[node] {
                        Node::Region { .. } => {
                            if let Some(children) = attachments.get(&(id, node)) {
                                for &child in children.iter().rev() {
                                    let child_owner = records[&child];
                                    pending.extend(
                                        child_owner
                                            .template
                                            .source
                                            .nodes
                                            .iter()
                                            .enumerate()
                                            .rev()
                                            .filter(|(node, source)| {
                                                source.parent().is_none()
                                                    && !ignorable_root(child_owner, *node)
                                            })
                                            .map(|(node, _)| (child, node, ancestry.clone())),
                                    );
                                }
                            }
                        }
                        Node::Text { .. } => fragments.push(Arc::new(TextPath {
                            source,
                            ancestry: ancestry.into(),
                        })),
                        Node::Element { tag, .. } if tag == "br" => {
                            fragments.push(Arc::new(TextPath {
                                source,
                                ancestry: ancestry.into(),
                            }))
                        }
                        Node::Element { .. } => {
                            // Placement validation already rejects blocks and
                            // controls under phrasing parents, through wrappers.
                            debug_assert!(is_inline(owner, node));
                            ancestry.push(source);
                            pending.extend(
                                owner.template.children[node]
                                    .iter()
                                    .rev()
                                    .map(|&child| (id, child, ancestry.clone())),
                            );
                        }
                    }
                }
                plan.groups.insert(identity, fragments);
            }
        }
        plan
    }

    /// Compute candidate values without mutating any accepted record. Revision
    /// changes happen once, after the final writes and row order are known.
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
            let fragments = &self.groups[&identity];
            let definition = &instance.template.presentation.groups[group];
            let mut text = instance
                .markers
                .get(&group)
                .unwrap_or(&definition.prefix)
                .clone();
            let mut runs = Vec::new();
            if !text.is_empty() {
                runs.push(TextRange {
                    node: None,
                    len: text.len(),
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
            let previous = &instance.text_groups[group];
            if previous.text.as_ref() != text || previous.runs.as_ref() != runs {
                updates.push((
                    instance.handle,
                    group,
                    TextValue {
                        text: text.into(),
                        runs: runs.into(),
                        revision: if mounted.contains(&id) {
                            1
                        } else {
                            previous.revision + 1
                        },
                    },
                ));
            }
        }
        updates
    }
}

fn is_inline(instance: &Instance, node: usize) -> bool {
    matches!(&instance.template.source.nodes[node], Node::Element { tag, .. }
        if tags::resolve(tag).is_ok_and(|tag| tag.layout == Layout::Inline))
}

fn ignorable_root(instance: &Instance, node: usize) -> bool {
    matches!(&instance.template.source.nodes[node], Node::Text { text, .. }
        if text.trim().is_empty()
            && !instance.template.source.slots.iter().any(|slot| slot.node == node))
}
