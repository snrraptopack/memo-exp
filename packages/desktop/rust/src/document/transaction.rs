//! Complete candidate validation before any live structural publication.
//!
//! Only new/retired owners and changed generation marks are staged. Live source
//! kinds and descendant boundaries are read from Blitz on demand. Moves stay in
//! their original destination, so they cannot change owner containment or create
//! cycles. There is no shadow rendered tree or application state in this layer.

use std::collections::HashMap;

use super::mutations::SourceKind;
use super::{
    DocumentError, MountTarget, Mutation, NativeDocument, NodeRef, Owner, ValidatedTemplate,
};

#[derive(Debug)]
pub enum Operation<'template> {
    Mount {
        owner: Owner,
        template: &'template ValidatedTemplate,
        target: MountTarget,
    },
    Write(Mutation),
    MoveBefore {
        owner: Owner,
        before: Owner,
    },
    MoveToEnd {
        owner: Owner,
    },
    Retire {
        owner: Owner,
    },
}

enum StagedInstance<'template> {
    Mounted {
        template: &'template ValidatedTemplate,
        target: MountTarget,
    },
    Retired,
}

struct StagedTopology<'document, 'template> {
    document: &'document NativeDocument,
    instances: HashMap<Owner, StagedInstance<'template>>,
    generations: HashMap<String, u64>,
    /// Only candidate mounts need these edges. Live descendants come from the
    /// actual engine ranges and the existing reverse boundary index.
    children: HashMap<Owner, Vec<Owner>>,
}

impl NativeDocument {
    /// Validate the complete authored operation order, then apply it exclusively.
    /// No paint/input can borrow this document between the operation mutations.
    /// A prepared batch never escapes this method or outlives its validation.
    pub fn transact(&mut self, operations: &[Operation<'_>]) -> Result<(), DocumentError> {
        self.ensure_live()?;
        StagedTopology::new(self).validate(operations)?;

        // Reuse the established native operations and their unwind boundaries.
        // A failure in an already validated batch is ambiguous, even if an inner
        // operation returns what would otherwise be an ordinary validation error.
        let applied = self.apply(|document| {
            let result = document.apply_operations(operations);
            if result.is_err() {
                // Do not release provider work for an unexpected prepared error.
                document.failed = true;
            }
            result
        })?;

        if applied.is_err() {
            self.failed = true;
            self.providers.fail();
            return Err(DocumentError::ApplicationFailed);
        }
        Ok(())
    }

    fn apply_operations(&mut self, operations: &[Operation<'_>]) -> Result<(), DocumentError> {
        let document = self;
        let mut index = 0;
        while let Some(operation) = operations.get(index) {
            match operation {
                Operation::Mount {
                    owner,
                    template,
                    target,
                } => {
                    document.mount(owner.clone(), template, target.clone())?;
                }
                Operation::Write(_) => {
                    let count = operations[index..]
                        .iter()
                        .take_while(|operation| matches!(operation, Operation::Write(_)))
                        .count();
                    let writes = operations[index..index + count]
                        .iter()
                        .filter_map(|operation| {
                            if let Operation::Write(write) = operation {
                                Some(write)
                            } else {
                                None
                            }
                        });
                    document.update_iter(writes)?;
                    index += count;
                    continue;
                }
                Operation::MoveBefore { owner, before } => document.move_before(owner, before)?,
                Operation::MoveToEnd { owner } => document.move_to_end(owner)?,
                Operation::Retire { owner } => document.retire(owner)?,
            }
            index += 1;
        }
        Ok::<(), DocumentError>(())
    }
}

impl<'document, 'template> StagedTopology<'document, 'template> {
    fn new(document: &'document NativeDocument) -> Self {
        Self {
            document,
            instances: HashMap::new(),
            generations: HashMap::new(),
            children: HashMap::new(),
        }
    }

    fn validate(mut self, operations: &[Operation<'template>]) -> Result<(), DocumentError> {
        for operation in operations {
            match operation {
                Operation::Mount {
                    owner,
                    template,
                    target,
                } => self.mount(owner, template, target)?,
                Operation::Write(write) => {
                    write.validate_name()?;
                    write.validate_kind(self.source_kind(write.target())?)?;
                }
                Operation::MoveBefore { owner, before } => {
                    let target = self.instance_target(owner)?;
                    let next = self.instance_target(before)?;
                    if target != next {
                        return Err(DocumentError::DifferentTarget);
                    }
                    self.validate_range(owner)?;
                    self.validate_range(before)?;
                }
                Operation::MoveToEnd { owner } => {
                    self.destination(self.instance_target(owner)?)?;
                    self.validate_range(owner)?;
                }
                Operation::Retire { owner } => self.retire(owner)?,
            }
        }
        Ok(())
    }

    fn mount(
        &mut self,
        owner: &Owner,
        template: &'template ValidatedTemplate,
        target: &MountTarget,
    ) -> Result<(), DocumentError> {
        if owner.id.is_empty() || owner.generation == 0 {
            return Err(DocumentError::InvalidOwner);
        }
        let previous = self
            .generations
            .get(&owner.id)
            .or_else(|| self.document.generations.get(&owner.id));
        if let Some(previous) = previous {
            let active = Owner::new(&owner.id, *previous);
            if self.instance_target(&active).is_ok() {
                return Err(DocumentError::DuplicateOwner);
            }
            if owner.generation <= *previous {
                return Err(DocumentError::StaleGeneration);
            }
        }
        self.destination(target)?;

        if let MountTarget::Element(source) | MountTarget::Region(source) = target {
            self.children
                .entry(source.owner.clone())
                .or_default()
                .push(owner.clone());
        }
        self.generations.insert(owner.id.clone(), owner.generation);
        self.instances.insert(
            owner.clone(),
            StagedInstance::Mounted {
                template,
                target: target.clone(),
            },
        );
        Ok(())
    }

    fn source_kind(&self, source: &NodeRef) -> Result<SourceKind, DocumentError> {
        match self.instances.get(&source.owner) {
            Some(StagedInstance::Retired) => Err(DocumentError::UnknownOwner),
            Some(StagedInstance::Mounted { template, .. }) => {
                let node = template
                    .template
                    .nodes
                    .get(source.source as usize)
                    .ok_or(DocumentError::UnknownSource)?;
                Ok(SourceKind::from(&node.node))
            }
            None => {
                let node = self.document.node_id(source)?;
                let node = self
                    .document
                    .document
                    .get_node(node)
                    .ok_or(DocumentError::MissingEngineNode)?;
                Ok(SourceKind::from(&node.data))
            }
        }
    }

    fn instance_target(&self, owner: &Owner) -> Result<&MountTarget, DocumentError> {
        match self.instances.get(owner) {
            Some(StagedInstance::Retired) => Err(DocumentError::UnknownOwner),
            Some(StagedInstance::Mounted { target, .. }) => Ok(target),
            None => self
                .document
                .instances
                .get(owner)
                .map(|instance| &instance.target)
                .ok_or(DocumentError::UnknownOwner),
        }
    }

    fn destination(&self, target: &MountTarget) -> Result<(), DocumentError> {
        let (source, required) = match target {
            MountTarget::Body => return Ok(()),
            MountTarget::Element(source) => (source, SourceKind::Element),
            MountTarget::Region(source) => (source, SourceKind::Comment),
        };
        if self.source_kind(source)? != required {
            return Err(DocumentError::WrongNodeKind);
        }
        if !matches!(
            self.instances.get(&source.owner),
            Some(StagedInstance::Mounted { .. })
        ) {
            self.document.destination(target)?;
        }
        Ok(())
    }

    fn validate_range(&self, owner: &Owner) -> Result<(), DocumentError> {
        self.instance_target(owner)?;
        if !matches!(
            self.instances.get(owner),
            Some(StagedInstance::Mounted { .. })
        ) {
            self.document.instance_range(owner)?;
        }
        Ok(())
    }

    fn retire(&mut self, owner: &Owner) -> Result<(), DocumentError> {
        self.validate_range(owner)?;
        let mut owners = vec![owner.clone()];
        if !matches!(
            self.instances.get(owner),
            Some(StagedInstance::Mounted { .. })
        ) {
            // Read only the actual range being retired. This is not a registry
            // scan, and the temporary traversal is discarded after validation.
            let mut nodes = self.document.instance_range(owner)?;
            while let Some(id) = nodes.pop() {
                let node = self
                    .document
                    .document
                    .get_node(id)
                    .ok_or(DocumentError::MissingEngineNode)?;
                nodes.extend_from_slice(&node.children);
                if let Some(descendant) = self.document.owner_boundaries.get(&id) {
                    owners.push(descendant.clone());
                }
            }
        }
        while let Some(owner) = owners.pop() {
            if matches!(self.instances.get(&owner), Some(StagedInstance::Retired)) {
                continue;
            }
            if let Some(children) = self.children.remove(&owner) {
                owners.extend(children);
            }
            self.instances.insert(owner, StagedInstance::Retired);
        }
        Ok(())
    }
}
