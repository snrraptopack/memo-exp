//! Persistent scene state and atomic publication, independent of window presentation.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Template {
    pub id: String,
    pub nodes: Vec<Node>,
    pub slots: Vec<TextSlot>,
    pub events: Vec<Event>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Primitive {
    Container,
    Button,
    Text,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Node {
    pub kind: Primitive,
    pub parent: Option<usize>,
    pub text: String,
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
    pub template: Arc<Template>,
    pub texts: Vec<String>,
    pub dirty: BTreeSet<usize>,
}
#[derive(Default)]
pub struct Scene {
    templates: BTreeMap<String, Arc<Template>>,
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
}

impl Scene {
    pub fn install(&mut self, template: Template) -> Result<(), String> {
        if template.id.is_empty() || template.nodes.is_empty() {
            return Err("Empty scene template".into());
        }
        let mut roots = 0;
        for (index, node) in template.nodes.iter().enumerate() {
            match node.parent {
                None => roots += 1,
                Some(parent) if parent < index => {}
                _ => return Err("Template parent must precede its child".into()),
            }
        }
        if roots != 1 {
            return Err("Template must contain exactly one root".into());
        }
        let mut slots = BTreeSet::new();
        for slot in &template.slots {
            if !matches!(
                template.nodes.get(slot.node).map(|node| &node.kind),
                Some(Primitive::Text)
            ) || !slots.insert(slot.node)
            {
                return Err("Invalid or duplicate text slot".into());
            }
        }
        let mut events = BTreeSet::new();
        for event in &template.events {
            if !matches!(
                template.nodes.get(event.node).map(|node| &node.kind),
                Some(Primitive::Button)
            ) || !events.insert(event.node)
            {
                return Err("Invalid or duplicate click event".into());
            }
        }
        if let Some(existing) = self.templates.get(&template.id) {
            return if **existing == template {
                Ok(())
            } else {
                Err("Template identity has conflicting definitions".into())
            };
        }
        self.templates
            .insert(template.id.clone(), Arc::new(template));
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
                    if values.len() != template.slots.len() {
                        return Err("Initial scene values do not cover every slot".into());
                    }
                    let mut instance = Instance {
                        handle,
                        texts: template
                            .nodes
                            .iter()
                            .map(|node| node.text.clone())
                            .collect(),
                        dirty: (0..template.nodes.len()).collect(),
                        template,
                    };
                    apply_writes(&mut instance, values)?;
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
                    template: instance.template.id.clone(),
                    texts: instance.texts.clone(),
                    dirty: instance.dirty.iter().copied().collect(),
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
            .slots
            .get(write.slot)
            .ok_or("Unknown scene slot")?;
        if instance.texts[slot.node] != write.value {
            instance.texts[slot.node] = write.value;
            instance.dirty.insert(slot.node);
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
            {"kind":"button","parent":null,"text":""}, {"kind":"text","parent":0,"text":""}],
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
        changed.nodes[1].text = "different".into();
        assert!(scene.install(changed).is_err());
        let mut cycle = template();
        cycle.nodes[1].parent = Some(1);
        assert!(scene.install(cycle).is_err());
    }
}
