use blitz_dom::NodeId;

use super::{DocumentError, NativeDocument, Owner};

impl NativeDocument {
    pub fn move_before(&mut self, owner: &Owner, before: &Owner) -> Result<(), DocumentError> {
        self.ensure_live()?;
        let instance = self
            .instances
            .get(owner)
            .ok_or(DocumentError::UnknownOwner)?;
        let next = self
            .instances
            .get(before)
            .ok_or(DocumentError::UnknownOwner)?;
        if instance.target != next.target {
            return Err(DocumentError::DifferentTarget);
        }
        let range = self.instance_range(owner)?;
        let anchor = next.start;
        self.instance_range(before)?;
        if owner == before {
            return Ok(());
        }
        self.apply(|host| host.document.mutate().insert_nodes_before(anchor, &range))
    }

    pub fn move_to_end(&mut self, owner: &Owner) -> Result<(), DocumentError> {
        self.ensure_live()?;
        let instance = self
            .instances
            .get(owner)
            .ok_or(DocumentError::UnknownOwner)?;
        let (parent, anchor) = self.destination(&instance.target)?;
        let range = self.instance_range(owner)?;

        self.apply(|host| {
            let mut mutation = host.document.mutate();
            match anchor {
                Some(anchor) => mutation.insert_nodes_before(anchor, &range),
                None => mutation.append_children(parent, &range),
            }
        })
    }

    pub fn retire(&mut self, owner: &Owner) -> Result<(), DocumentError> {
        self.ensure_live()?;
        let range = self.instance_range(owner)?;
        let mut dropped = Vec::new();

        self.apply(move |host| {
            {
                let mut mutation = host.document.mutate();
                for node in range {
                    mutation.remove_and_drop_node_with(node, &mut |node| {
                        dropped.push(node);
                    });
                }
            }
            // A parent range can contain descendant component ranges, including
            // empty fragments. Engine destruction reports their boundaries too.
            for node in dropped {
                #[cfg(feature = "window")]
                host.source_nodes.remove(&node);
                if let Some(owner) = host.owner_boundaries.remove(&node) {
                    host.instances.remove(&owner);
                }
            }
            // Generation high-water marks survive retirement. Old packets must
            // stay invalid even if a source slot or component ID is reused.
        })
    }

    pub(super) fn instance_range(&self, owner: &Owner) -> Result<Vec<NodeId>, DocumentError> {
        let instance = self
            .instances
            .get(owner)
            .ok_or(DocumentError::UnknownOwner)?;
        let start = self
            .document
            .get_node(instance.start)
            .ok_or(DocumentError::InvalidRange)?;
        let end = self
            .document
            .get_node(instance.end)
            .ok_or(DocumentError::InvalidRange)?;
        if start.parent != end.parent {
            return Err(DocumentError::InvalidRange);
        }
        let parent = start
            .parent
            .and_then(|parent| self.document.get_node(parent))
            .ok_or(DocumentError::InvalidRange)?;
        let first = parent
            .children
            .iter()
            .position(|node| *node == instance.start)
            .ok_or(DocumentError::InvalidRange)?;
        let last = parent
            .children
            .iter()
            .position(|node| *node == instance.end)
            .ok_or(DocumentError::InvalidRange)?;
        if first > last {
            return Err(DocumentError::InvalidRange);
        }
        Ok(parent.children[first..=last].to_vec())
    }
}
