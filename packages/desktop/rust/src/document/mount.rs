use blitz_dom::{NodeData, NodeId};

use super::instance::Instance;
use super::{DocumentError, MountTarget, NativeDocument, Owner, SourceNode, ValidatedTemplate};

impl NativeDocument {
    pub fn mount(
        &mut self,
        owner: Owner,
        template: &ValidatedTemplate,
        target: MountTarget,
    ) -> Result<(), DocumentError> {
        self.ensure_live()?;
        self.validate_owner(&owner)?;
        let (parent, anchor) = self.destination(&target)?;

        // Reserve bookkeeping before constructing a live mutator. Templates
        // already passed their topology/name checks without touching the engine.
        let mut nodes = Vec::with_capacity(template.source_count());
        let mut roots = Vec::with_capacity(template.roots.len() + 2);
        self.apply(move |host| {
            let start;
            let end;
            {
                let mut mutation = host.document.mutate();
                start = mutation.create_comment_node("memo:instance:start");
                roots.push(start);

                for source in &template.template.nodes {
                    let node = match &source.node {
                        SourceNode::Element { name, attributes } => {
                            mutation.create_element(name.clone(), attributes.clone())
                        }
                        SourceNode::Text(text) => mutation.create_text_node(text),
                        SourceNode::Comment(text) => mutation.create_comment_node(text),
                    };
                    nodes.push(node);
                    if let Some(parent) = source.parent {
                        mutation.append_children(nodes[parent as usize], &[node]);
                    }
                }
                for source in &template.roots {
                    roots.push(nodes[*source as usize]);
                }
                end = mutation.create_comment_node("memo:instance:end");
                roots.push(end);

                match anchor {
                    Some(anchor) => mutation.insert_nodes_before(anchor, &roots),
                    None => mutation.append_children(parent, &roots),
                }
            }

            host.generations.insert(owner.id.clone(), owner.generation);
            host.owner_boundaries.insert(start, owner.clone());
            #[cfg(feature = "window")]
            for (source, node) in nodes.iter().enumerate() {
                host.source_nodes.insert(*node, owner.node(source as u32));
            }
            host.instances.insert(
                owner,
                Instance {
                    nodes,
                    start,
                    end,
                    target,
                },
            );
        })
    }

    fn validate_owner(&self, owner: &Owner) -> Result<(), DocumentError> {
        if owner.id.is_empty() || owner.generation == 0 {
            return Err(DocumentError::InvalidOwner);
        }
        if let Some(previous) = self.generations.get(&owner.id) {
            let active = Owner::new(&owner.id, *previous);
            if self.instances.contains_key(&active) {
                return Err(DocumentError::DuplicateOwner);
            }
            if owner.generation <= *previous {
                return Err(DocumentError::StaleGeneration);
            }
        }
        Ok(())
    }

    pub(super) fn destination(
        &self,
        target: &MountTarget,
    ) -> Result<(NodeId, Option<NodeId>), DocumentError> {
        match target {
            MountTarget::Body => Ok((self.mount_parent(), None)),
            MountTarget::Element(source) => {
                let id = self.node_id(source)?;
                let node = self
                    .document
                    .get_node(id)
                    .ok_or(DocumentError::MissingEngineNode)?;
                if !matches!(node.data, NodeData::Element(_)) {
                    return Err(DocumentError::WrongNodeKind);
                }
                Ok((id, None))
            }
            MountTarget::Region(source) => {
                let id = self.node_id(source)?;
                let node = self
                    .document
                    .get_node(id)
                    .ok_or(DocumentError::MissingEngineNode)?;
                if !matches!(node.data, NodeData::Comment { .. }) {
                    return Err(DocumentError::WrongNodeKind);
                }
                Ok((node.parent.ok_or(DocumentError::DetachedRegion)?, Some(id)))
            }
        }
    }
}
