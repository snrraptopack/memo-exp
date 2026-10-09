//! Component attachment, lifetime and authored traversal independent of GPUI.
use crate::{Handle, Instance, presentation::ItemKind, tags, template::Node};
use std::collections::{BTreeMap, BTreeSet};

/** Walk exact parent generations once, including records staged in this batch. */
pub(crate) fn descendants<'a>(
    records: impl Iterator<Item = &'a Instance>,
    root: Handle,
) -> Vec<u64> {
    let mut children = BTreeMap::<(u64, u64), Vec<Handle>>::new();
    for record in records {
        if let Some(parent) = record.attach_to {
            children
                .entry((parent.handle.id, parent.handle.generation))
                .or_default()
                .push(record.handle);
        }
    }
    let mut pending = vec![root];
    let mut retired = BTreeSet::new();
    while let Some(handle) = pending.pop() {
        if retired.insert(handle.id)
            && let Some(children) = children.get(&(handle.id, handle.generation))
        {
            pending.extend(children);
        }
    }
    retired.into_iter().collect()
}

pub(crate) fn validate(records: &BTreeMap<u64, &Instance>) -> Result<(), String> {
    let mut occupied = BTreeSet::new();
    let mut rows = BTreeMap::<(u64, usize), BTreeSet<(u64, u64)>>::new();
    for instance in records.values() {
        if let Some(attachment) = instance.attach_to {
            let parent = records
                .get(&attachment.handle.id)
                .ok_or("Component attachment targets a retired owner")?;
            if parent.handle != attachment.handle {
                return Err("Component attachment has a stale parent generation".into());
            }
            let Some(Node::Region { multiple, .. }) =
                parent.template.source.nodes.get(attachment.node)
            else {
                return Err("Component attachment requires a region destination".into());
            };
            if *multiple {
                rows.entry((attachment.handle.id, attachment.node))
                    .or_default()
                    .insert((instance.handle.id, instance.handle.generation));
            } else if !occupied.insert((attachment.handle.id, attachment.node)) {
                return Err("Component region is already occupied".into());
            }
        }
    }
    let mut checked = BTreeSet::new();
    for &id in records.keys() {
        let mut path = BTreeSet::new();
        let mut current = Some(id);
        while let Some(id) = current {
            if checked.contains(&id) {
                break;
            }
            if !path.insert(id) {
                return Err("Component attachments form a cycle".into());
            }
            current = records[&id].attach_to.map(|parent| parent.handle.id);
        }
        checked.extend(path);
    }
    for instance in records.values() {
        for (node, source) in instance.template.source.nodes.iter().enumerate() {
            if matches!(source, Node::Region { multiple: true, .. }) {
                let order = instance.orders.get(&node).map(Vec::as_slice).unwrap_or(&[]);
                let unique: BTreeSet<_> = order
                    .iter()
                    .map(|handle| (handle.id, handle.generation))
                    .collect();
                let members = rows.remove(&(instance.handle.id, node)).unwrap_or_default();
                if unique.len() != order.len() || unique != members {
                    return Err("Ordered region must name every attached row exactly once with its current generation".into());
                }
            }
        }
        // Regions have no layout wrapper. Resolve the actual authored parent
        // through region-only roots before validating each fragment root.
        let mut placement = instance.attach_to;
        let mut parent_tag = None;
        while let Some(attachment) = placement {
            let parent = records[&attachment.handle.id];
            if let Some(node) = parent.template.source.nodes[attachment.node].parent() {
                if let Node::Element { tag, .. } = &parent.template.source.nodes[node] {
                    parent_tag = Some(tags::resolve(tag)?);
                }
                break;
            }
            placement = parent.attach_to;
        }
        for (source, root) in instance
            .template
            .source
            .nodes
            .iter()
            .enumerate()
            .filter(|(_, node)| node.parent().is_none())
        {
            if matches!(root, Node::Region { .. }) {
                continue;
            }
            if matches!(root, Node::Text { text, .. } if text.trim().is_empty())
                && !instance
                    .template
                    .source
                    .slots
                    .iter()
                    .any(|slot| slot.node == source)
            {
                continue;
            }
            let child = if let Node::Element { tag, .. } = root {
                Some(tags::resolve(tag)?)
            } else {
                None
            };
            if child.is_some_and(|tag| tag.name == "li")
                && !parent_tag.is_some_and(|tag| matches!(tag.name, "ul" | "ol"))
            {
                return Err("<li> requires an <ul> or <ol> parent at component placement".into());
            }
            if parent_tag.is_some_and(|tag| !tag.accepts(child)) {
                return Err(
                    "Component roots violate the attachment parent's content contract".into(),
                );
            }
        }
    }
    Ok(())
}

/// Marker text belongs to placement, including regions between authored rows.
/// Return only changed groups so pure movement in <ul> retains shaped text.
pub(crate) fn markers(records: &BTreeMap<u64, &Instance>) -> Vec<(Handle, usize, String)> {
    let mut attached = BTreeMap::<(u64, usize), Vec<u64>>::new();
    for instance in records.values() {
        if let Some(parent) = instance.attach_to {
            attached
                .entry((parent.handle.id, parent.node))
                .or_default()
                .push(instance.handle.id);
        }
    }
    for instance in records.values() {
        for (&node, order) in &instance.orders {
            attached.insert(
                (instance.handle.id, node),
                order.iter().map(|handle| handle.id).collect(),
            );
        }
    }
    let mut changed = Vec::new();
    for parent in records.values() {
        for (node, source) in parent.template.source.nodes.iter().enumerate() {
            let Node::Element { tag, .. } = source else {
                continue;
            };
            if !matches!(tag.as_str(), "ul" | "ol") {
                continue;
            }
            let mut pending: Vec<_> = parent.template.children[node]
                .iter()
                .rev()
                .map(|&child| (parent.handle.id, child))
                .collect();
            let mut ordinal = 0;
            while let Some((id, source)) = pending.pop() {
                let row = records[&id];
                if matches!(row.template.source.nodes[source], Node::Region { .. }) {
                    if let Some(children) = attached.get(&(id, source)) {
                        for &child in children.iter().rev() {
                            pending.extend(
                                records[&child]
                                    .template
                                    .source
                                    .nodes
                                    .iter()
                                    .enumerate()
                                    .rev()
                                    .filter(|(_, node)| node.parent().is_none())
                                    .map(|(node, _)| (child, node)),
                            );
                        }
                    }
                } else if let Some(&group) = row.template.presentation.marker_groups.get(&source) {
                    ordinal += 1;
                    let prefix = if tag == "ol" {
                        format!("{ordinal}. ")
                    } else {
                        "• ".into()
                    };
                    let current = row
                        .markers
                        .get(&group)
                        .unwrap_or(&row.template.presentation.groups[group].prefix);
                    if current != &prefix {
                        changed.push((row.handle, group, prefix));
                    }
                }
            }
        }
    }
    changed
}

#[derive(Default)]
pub struct SceneOrder {
    /// Parent before descendants, with sibling regions in authored order.
    pub instances: Vec<Handle>,
    /// Focus traversal interleaves parent controls and child controls.
    pub controls: Vec<(Handle, usize)>,
}
enum Job {
    Instance(u64),
    Item(u64, usize),
}
pub(crate) fn order(records: &BTreeMap<u64, Instance>) -> SceneOrder {
    let mut attachments: BTreeMap<_, _> = records
        .values()
        .filter_map(|instance| {
            instance
                .attach_to
                .map(|parent| ((parent.handle.id, parent.node), vec![instance.handle.id]))
        })
        .collect();
    for instance in records.values() {
        for (&node, order) in &instance.orders {
            attachments.insert(
                (instance.handle.id, node),
                order.iter().map(|handle| handle.id).collect(),
            );
        }
    }
    let mut jobs: Vec<_> = records
        .values()
        .rev()
        .filter(|instance| instance.attach_to.is_none())
        .map(|instance| Job::Instance(instance.handle.id))
        .collect();
    let mut result = SceneOrder::default();
    while let Some(job) = jobs.pop() {
        match job {
            Job::Instance(id) => {
                let instance = &records[&id];
                result.instances.push(instance.handle);
                jobs.extend(
                    instance
                        .template
                        .presentation
                        .items
                        .iter()
                        .enumerate()
                        .rev()
                        .filter(|(_, item)| item.parent.is_none())
                        .map(|(index, _)| Job::Item(id, index)),
                );
            }
            Job::Item(id, index) => {
                let instance = &records[&id];
                let item = &instance.template.presentation.items[index];
                match item.kind {
                    ItemKind::Region => {
                        if let Some(children) = attachments.get(&(id, item.source)) {
                            jobs.extend(children.iter().rev().map(|&child| Job::Instance(child)));
                        }
                    }
                    ItemKind::Button | ItemKind::Input => {
                        result.controls.push((instance.handle, item.source))
                    }
                    _ => {}
                }
                jobs.extend(
                    instance.template.presentation.children[index]
                        .iter()
                        .rev()
                        .map(|&index| Job::Item(id, index)),
                );
            }
        }
    }
    result
}
