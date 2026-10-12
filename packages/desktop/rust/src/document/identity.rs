//! Protocol identities name source ownership, never a raw engine allocation.

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct Owner {
    pub id: String,
    pub generation: u64,
}

impl Owner {
    pub fn new(id: impl Into<String>, generation: u64) -> Self {
        Self {
            id: id.into(),
            generation,
        }
    }

    pub fn node(&self, source: u32) -> NodeRef {
        NodeRef {
            owner: self.clone(),
            source,
        }
    }
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
pub struct NodeRef {
    pub owner: Owner,
    pub source: u32,
}

/// Element children and comment-anchored regions retain the containing owner.
/// That edge is lifetime bookkeeping; the actual topology belongs to Blitz.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MountTarget {
    Body,
    Element(NodeRef),
    Region(NodeRef),
}
