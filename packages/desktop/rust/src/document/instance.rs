use blitz_dom::NodeId;

use super::MountTarget;

/// Only identities and lifetime edges are retained beside the engine tree.
pub(crate) struct Instance {
    pub nodes: Vec<NodeId>,
    pub start: NodeId,
    pub end: NodeId,
    pub target: MountTarget,
}
