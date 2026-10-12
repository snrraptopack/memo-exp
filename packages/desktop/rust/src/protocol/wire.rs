use blitz_dom::QualName;
use serde::Deserialize;

use crate::document::{Mutation, NodeRef, Owner};

use super::ProtocolError;

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_PACKET_BYTES: usize = 1_048_576;
pub const MAX_WRITES: usize = 4_096;

// These counters cross a JavaScript number boundary. A u64 parser alone would
// accept identities that the sender cannot represent without losing precision.
pub(super) const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const MAX_OWNER_BYTES: usize = 256;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WirePacket {
    version: u32,
    sequence: u64,
    writes: Vec<WireWrite>,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
enum WireWrite {
    Text {
        target: WireReference,
        value: String,
    },
    SetAttribute {
        target: WireReference,
        name: WireName,
        value: String,
    },
    RemoveAttribute {
        target: WireReference,
        name: WireName,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireReference {
    owner: WireOwner,
    source: u32,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireOwner {
    id: String,
    generation: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireName {
    namespace: String,
    local: String,
    prefix: Option<String>,
}

/// Only this decoder constructs a packet. Callers cannot change its sequence or
/// append unvalidated wire identities between decoding and document application.
pub(super) struct DecodedPacket {
    pub sequence: u64,
    pub writes: Vec<Mutation>,
}

impl DecodedPacket {
    pub fn decode(bytes: &[u8]) -> Result<Self, ProtocolError> {
        // Bound allocation before invoking the JSON parser. The process reader
        // must enforce this same bound while framing, before buffering a packet.
        if bytes.len() > MAX_PACKET_BYTES {
            return Err(ProtocolError::PacketTooLarge);
        }
        let packet: WirePacket = serde_json::from_slice(bytes)
            .map_err(|error| ProtocolError::Decode(error.to_string()))?;
        if packet.version != PROTOCOL_VERSION {
            return Err(ProtocolError::UnsupportedVersion {
                received: packet.version,
            });
        }
        if packet.sequence == 0 || packet.sequence > MAX_SAFE_INTEGER {
            return Err(ProtocolError::InvalidSequence);
        }
        if packet.writes.len() > MAX_WRITES {
            return Err(ProtocolError::TooManyWrites);
        }
        let writes = packet
            .writes
            .into_iter()
            .map(WireWrite::into_mutation)
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            sequence: packet.sequence,
            writes,
        })
    }
}

impl WireWrite {
    fn into_mutation(self) -> Result<Mutation, ProtocolError> {
        match self {
            Self::Text { target, value } => Ok(Mutation::Text {
                target: target.into_reference()?,
                value,
            }),
            Self::SetAttribute {
                target,
                name,
                value,
            } => Ok(Mutation::Attribute {
                target: target.into_reference()?,
                name: name.into_qualified_name(),
                value: Some(value),
            }),
            Self::RemoveAttribute { target, name } => Ok(Mutation::Attribute {
                target: target.into_reference()?,
                name: name.into_qualified_name(),
                value: None,
            }),
        }
    }
}

impl WireReference {
    fn into_reference(self) -> Result<NodeRef, ProtocolError> {
        if self.owner.id.is_empty()
            || self.owner.id.len() > MAX_OWNER_BYTES
            || self.owner.generation == 0
            || self.owner.generation > MAX_SAFE_INTEGER
        {
            return Err(ProtocolError::InvalidIdentity);
        }
        Ok(Owner::new(self.owner.id, self.owner.generation).node(self.source))
    }
}

impl WireName {
    fn into_qualified_name(self) -> QualName {
        QualName::new(
            self.prefix.map(Into::into),
            self.namespace.into(),
            self.local.into(),
        )
    }
}
