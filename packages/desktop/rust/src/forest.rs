//! Component attachment, lifetime and authored traversal independent of GPUI.
use crate::{Handle, Instance, presentation::ItemKind, template::Node};
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
    for instance in records.values() {
        if let Some(attachment) = instance.attach_to {
            let parent = records
                .get(&attachment.handle.id)
                .ok_or("Component attachment targets a retired owner")?;
            if parent.handle != attachment.handle {
                return Err("Component attachment has a stale parent generation".into());
            }
            if !matches!(
                parent.template.source.nodes.get(attachment.node),
                Some(Node::Region { .. })
            ) {
                return Err("Component attachment requires a region destination".into());
            }
            if !occupied.insert((attachment.handle.id, attachment.node)) {
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
    Ok(())
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
    let attachments: BTreeMap<_, _> = records
        .values()
        .filter_map(|instance| {
            instance
                .attach_to
                .map(|parent| ((parent.handle.id, parent.node), instance.handle.id))
        })
        .collect();
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
                        if let Some(&child) = attachments.get(&(id, item.source)) {
                            jobs.push(Job::Instance(child));
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
