//! Interaction ordering is independent of publication sequence numbers.
use serde::{Deserialize, Serialize};

use crate::document::ControlState;
use crate::document::NodeRef;
use blitz_traits::events::{BlitzKeyEvent, DomEventData};
use keyboard_types::{Location, Modifiers};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KeyboardState {
    key: String,
    code: String,
    location: u8,
    repeat: bool,
    is_composing: bool,
    alt_key: bool,
    ctrl_key: bool,
    meta_key: bool,
    shift_key: bool,
}

impl From<&BlitzKeyEvent> for KeyboardState {
    fn from(event: &BlitzKeyEvent) -> Self {
        Self {
            key: event.key.to_string(),
            code: event.code.to_string(),
            location: match event.location {
                Location::Standard => 0,
                Location::Left => 1,
                Location::Right => 2,
                Location::Numpad => 3,
            },
            repeat: event.is_auto_repeating,
            is_composing: event.is_composing,
            alt_key: event.modifiers.contains(Modifiers::ALT),
            ctrl_key: event.modifiers.contains(Modifiers::CONTROL),
            meta_key: event.modifiers.contains(Modifiers::META),
            shift_key: event.modifiers.contains(Modifiers::SHIFT),
        }
    }
}

impl KeyboardState {
    pub fn from_data(data: &DomEventData) -> Option<Self> {
        match data {
            DomEventData::KeyDown(event) | DomEventData::KeyUp(event) => Some(event.into()),
            _ => None,
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct DispatchDecision {
    pub kind: DecisionKind,
    pub version: u32,
    pub dispatch_id: u64,
    pub cancelled: bool,
    #[serde(default)]
    pub controls: Vec<ControlledValue>,
}

#[derive(Deserialize)]
#[serde(tag = "op", deny_unknown_fields)]
pub(crate) enum ControlledValue {
    #[serde(rename = "setValue")]
    Value {
        target: crate::protocol::WireReference,
        value: String,
        revision: u64,
        version: u64,
    },
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub control: Option<ControlState>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keyboard: Option<KeyboardState>,
}
