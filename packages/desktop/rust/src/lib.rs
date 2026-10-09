//! Persistent scene state and atomic publication, independent of window presentation.
pub mod bridge;
pub mod css;
pub mod presentation;
pub mod tags;
pub mod template;
use presentation::{FlowItem, TextValue};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use template::PreparedTemplate;
pub use template::{Node, Template};

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Handle {
    pub id: u64,
    pub generation: u64,
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextWrite {
    pub slot: usize,
    pub value: String,
}
#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum Operation {
    Mount {
        handle: Handle,
        template: String,
        values: Vec<TextWrite>,
    },
    Update {
        handle: Handle,
        values: Vec<TextWrite>,
    },
    Dispose {
        handle: Handle,
    },
}
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Transaction {
    pub sequence: u64,
    pub operations: Vec<Operation>,
}
#[derive(Clone)]
pub struct Instance {
    pub handle: Handle,
    pub template: Arc<PreparedTemplate>,
    pub texts: Vec<String>,
    pub dirty: BTreeSet<usize>,
    pub text_groups: Vec<TextValue>,
    pending_groups: BTreeSet<usize>,
}
#[derive(Default)]
pub struct Scene {
    templates: BTreeMap<String, Arc<PreparedTemplate>>,
    instances: BTreeMap<u64, Instance>,
    generations: BTreeMap<u64, u64>,
    sequence: u64,
}
#[derive(Serialize)]
pub struct Snapshot {
    pub sequence: u64,
    pub instances: Vec<InstanceSnapshot>,
}
#[derive(Serialize)]
pub struct InstanceSnapshot {
    pub handle: Handle,
    pub template: String,
    pub texts: Vec<String>,
    pub dirty: Vec<usize>,
    pub presentation: Vec<FlowItem>,
    pub text_groups: Vec<TextValue>,
}

impl Scene {
    pub fn instances(&self) -> impl Iterator<Item = &Instance> {
        self.instances.values()
    }
    pub fn sequence(&self) -> u64 {
        self.sequence
    }
    pub fn has_event(&self, handle: Handle, site: usize) -> bool {
        self.instances.get(&handle.id).is_some_and(|instance| {
            instance.handle == handle && site < instance.template.source.events.len()
        })
    }

    pub fn install(&mut self, template: Template) -> Result<(), String> {
        self.install_with(template, |_| Ok(()))
    }

    pub fn install_with(
        &mut self,
        template: Template,
        prepare: impl FnOnce(&PreparedTemplate) -> Result<(), String>,
    ) -> Result<(), String> {
        if let Some(existing) = self.templates.get(&template.id) {
            return if existing.source == template {
                Ok(())
            } else {
                Err("Template identity has conflicting definitions".into())
            };
        }
        let template = template.prepare()?;
        prepare(&template)?;
        self.templates
            .insert(template.source.id.clone(), Arc::new(template));
        Ok(())
    }

    /// Stage only touched instances. No visible record or generation changes on failure.
    pub fn commit(&mut self, transaction: Transaction) -> Result<u64, String> {
        if transaction.sequence != self.sequence + 1 {
            return Err("Out-of-order scene transaction".into());
        }
        let mut staged = BTreeMap::<u64, Option<Instance>>::new();
        let mut generations = BTreeMap::<u64, u64>::new();
        for operation in transaction.operations {
            match operation {
                Operation::Mount {
                    handle,
                    template,
                    values,
                } => {
                    validate_handle(handle)?;
                    let previous = staged
                        .get(&handle.id)
                        .map(|value| value.as_ref())
                        .unwrap_or_else(|| self.instances.get(&handle.id));
                    if previous.is_some() {
                        return Err("Scene handle is already mounted".into());
                    }
                    let generation = generations
                        .get(&handle.id)
                        .or_else(|| self.generations.get(&handle.id))
                        .copied()
                        .unwrap_or(0);
                    if handle.generation <= generation {
                        return Err("Retired scene generation".into());
                    }
                    let template = self
                        .templates
                        .get(&template)
                        .ok_or("Unknown scene template")?
                        .clone();
                    if values.len() != template.source.slots.len() {
                        return Err("Initial scene values do not cover every slot".into());
                    }
                    let texts: Vec<String> = template
                        .source
                        .nodes
                        .iter()
                        .map(|node| node.text().to_owned())
                        .collect();
                    let mut instance = Instance {
                        handle,
                        text_groups: Vec::new(),
                        texts,
                        dirty: (0..template.source.nodes.len()).collect(),
                        pending_groups: BTreeSet::new(),
                        template,
                    };
                    apply_writes(&mut instance, values)?;
                    instance.text_groups = instance.template.presentation.values(&instance.texts);
                    instance.pending_groups.clear();
                    staged.insert(handle.id, Some(instance));
                    generations.insert(handle.id, handle.generation);
                }
                Operation::Update { handle, values } => {
                    let instance = stage_instance(&self.instances, &mut staged, handle)?;
                    apply_writes(instance, values)?;
                }
                Operation::Dispose { handle } => {
                    stage_instance(&self.instances, &mut staged, handle)?;
                    staged.insert(handle.id, None);
                }
            }
        }
        // All operations have validated. Prepare each affected paragraph once,
        // on candidate state, before swapping any instance into the live scene.
        for instance in staged.values_mut().flatten() {
            instance.template.presentation.refresh(
                &instance.texts,
                &mut instance.text_groups,
                &instance.pending_groups,
            );
            instance.pending_groups.clear();
        }
        for (id, instance) in staged {
            if let Some(instance) = instance {
                self.instances.insert(id, instance);
            } else {
                self.instances.remove(&id);
            }
        }
        self.generations.extend(generations);
        self.sequence = transaction.sequence;
        Ok(self.sequence)
    }

    pub fn snapshot(&self) -> Snapshot {
        Snapshot {
            sequence: self.sequence,
            instances: self
                .instances
                .values()
                .map(|instance| InstanceSnapshot {
                    handle: instance.handle,
                    template: instance.template.source.id.clone(),
                    texts: instance.texts.clone(),
                    dirty: instance.dirty.iter().copied().collect(),
                    presentation: instance.template.presentation.items.clone(),
                    text_groups: instance.text_groups.clone(),
                })
                .collect(),
        }
    }
}

fn validate_handle(handle: Handle) -> Result<(), String> {
    const JS_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
    if handle.id == 0
        || handle.generation == 0
        || handle.id > JS_SAFE_INTEGER
        || handle.generation > JS_SAFE_INTEGER
    {
        return Err("Invalid scene handle".into());
    }
    Ok(())
}
fn stage_instance<'a>(
    live: &BTreeMap<u64, Instance>,
    staged: &'a mut BTreeMap<u64, Option<Instance>>,
    handle: Handle,
) -> Result<&'a mut Instance, String> {
    validate_handle(handle)?;
    let candidate = staged
        .entry(handle.id)
        .or_insert_with(|| live.get(&handle.id).cloned());
    let instance = candidate
        .as_mut()
        .ok_or("Unknown or disposed scene handle")?;
    if instance.handle != handle {
        return Err("Stale scene handle generation".into());
    }
    Ok(instance)
}
fn apply_writes(instance: &mut Instance, writes: Vec<TextWrite>) -> Result<(), String> {
    let mut seen = BTreeSet::new();
    for write in writes {
        if !seen.insert(write.slot) {
            return Err("Duplicate scene slot write".into());
        }
        let slot = instance
            .template
            .source
            .slots
            .get(write.slot)
            .ok_or("Unknown scene slot")?;
        if instance.texts[slot.node] != write.value {
            instance.texts[slot.node] = write.value;
            instance.dirty.insert(slot.node);
            if let Some(group) = instance.template.presentation.group_for_node[slot.node] {
                instance.pending_groups.insert(group);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn template() -> Template {
        serde_json::from_value(json!({"id":"counter", "nodes":[
            {"kind":"element","tag":"button","parent":null,"text":""}, {"kind":"text","parent":0,"text":""}],
            "slots":[{"node":1,"type":"text"}],"events":[{"node":0,"type":"click"}]}))
        .unwrap()
    }
    fn transaction(sequence: u64, operations: serde_json::Value) -> Transaction {
        serde_json::from_value(json!({"sequence":sequence,"operations":operations})).unwrap()
    }
    fn mount(generation: u64) -> serde_json::Value {
        json!({"kind":"mount","handle":{"id":1,"generation":generation},"template":"counter","values":[{"slot":0,"value":"0"}]})
    }
    #[test]
    fn failed_publication_preserves_every_record_and_sequence() {
        let mut scene = Scene::default();
        scene.install(template()).unwrap();
        scene.commit(transaction(1, json!([mount(1)]))).unwrap();
        let before = serde_json::to_value(scene.snapshot()).unwrap();
        assert!(scene.commit(transaction(2,json!([
            {"kind":"update","handle":{"id":1,"generation":1},"values":[{"slot":0,"value":"1"}]},
            {"kind":"update","handle":{"id":1,"generation":1},"values":[{"slot":99,"value":"bad"}]}
        ]))).is_err());
        assert_eq!(before, serde_json::to_value(scene.snapshot()).unwrap());
        scene.commit(transaction(2,json!([{"kind":"update","handle":{"id":1,"generation":1},"values":[{"slot":0,"value":"1"}]}]))).unwrap();
        assert_eq!(scene.snapshot().instances[0].texts[1], "1");
    }
    #[test]
    fn retired_handles_cannot_target_a_reused_instance() {
        let mut scene = Scene::default();
        scene.install(template()).unwrap();
        scene.commit(transaction(1, json!([mount(1)]))).unwrap();
        scene
            .commit(transaction(
                2,
                json!([{"kind":"dispose","handle":{"id":1,"generation":1}}]),
            ))
            .unwrap();
        assert!(scene.commit(transaction(3, json!([mount(1)]))).is_err());
        scene.commit(transaction(3, json!([mount(2)]))).unwrap();
        assert!(
            scene
                .commit(transaction(
                    4,
                    json!([{"kind":"dispose","handle":{"id":1,"generation":1}}])
                ))
                .is_err()
        );
        assert_eq!(scene.snapshot().instances.len(), 1);
    }
    #[test]
    fn template_identity_is_immutable_and_structure_is_validated() {
        let mut scene = Scene::default();
        scene.install(template()).unwrap();
        scene.install(template()).unwrap();
        let mut changed = template();
        if let Node::Text { text, .. } = &mut changed.nodes[1] {
            *text = "different".into();
        }
        assert!(scene.install(changed).is_err());
        let mut cycle = template();
        if let Node::Text { parent, .. } = &mut cycle.nodes[1] {
            *parent = Some(1);
        }
        assert!(scene.install(cycle).is_err());
    }
}
