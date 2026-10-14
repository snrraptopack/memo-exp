//! Interaction ordering is independent of publication sequence numbers.
use serde::{Deserialize, Serialize};

use crate::document::NodeRef;

#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct DispatchDecision {
    pub kind: DecisionKind,
    pub version: u32,
    pub dispatch_id: u64,
    pub cancelled: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub(crate) enum DecisionKind {
    #[serde(rename = "dispatchResult")]
    DispatchResult,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EventPacket {
    pub kind: &'static str,
    pub version: u32,
    pub dispatch_id: u64,
    pub event_type: &'static str,
    pub path: Vec<NodeRef>,
    pub cancelable: bool,
    pub bubbles: bool,
    pub timestamp: f64,
    pub scene_sequence: u64,
}
