use serde::Deserialize;

use crate::document::NativeDocument;

use super::ProtocolError;
use super::operations::WireOperation;
use super::templates::{TemplateRegistry, WireTemplate, validate_declarations};

pub const PROTOCOL_VERSION: u32 = 1;
pub const MAX_PACKET_BYTES: usize = 1_048_576;
pub const MAX_OPERATIONS: usize = 4_096;
/// Retained for the initial write-set codec; both names describe the same limit.
pub const MAX_WRITES: usize = MAX_OPERATIONS;

// These counters cross a JavaScript number boundary. A u64 parser alone would
// accept identities that the sender cannot represent without losing precision.
pub(super) const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WirePacket {
    version: u32,
    sequence: u64,
    // Version 1's original write-set spelling remains accepted. Serde refuses
    // both spellings in one packet as a duplicate field, not two work streams.
    #[serde(alias = "writes")]
    operations: Vec<WireOperation>,
    #[serde(default)]
    templates: Vec<WireTemplate>,
}

/// Only this decoder constructs a packet. Application records remain inaccessible
/// until strict schema/version/sequence-size validation has succeeded.
pub(super) struct DecodedPacket {
    pub sequence: u64,
    operations: Vec<WireOperation>,
    templates: Vec<WireTemplate>,
}

impl DecodedPacket {
    pub fn decode(bytes: &[u8]) -> Result<Self, ProtocolError> {
        // The process reader must enforce the same bound while framing, before
        // buffering. This is the independent check on already framed bytes.
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
        if packet.operations.len() > MAX_OPERATIONS {
            return Err(ProtocolError::TooManyWrites);
        }
        Ok(Self {
            sequence: packet.sequence,
            operations: packet.operations,
            templates: packet.templates,
        })
    }

    pub fn apply_to(
        self,
        document: &mut NativeDocument,
        accepted: &mut TemplateRegistry,
    ) -> Result<(), ProtocolError> {
        let candidates = validate_declarations(self.templates, accepted)?;
        // Reserve acceptance bookkeeping before live application. Entries stay
        // unchanged on refusal; accepted payloads move into already reserved space.
        accepted.reserve(candidates.len());
        let operations = self
            .operations
            .into_iter()
            .map(|operation| operation.into_operation(accepted, &candidates))
            .collect::<Result<Vec<_>, _>>()?;

        document
            .transact(&operations)
            .map_err(ProtocolError::Refused)?;
        drop(operations);
        accepted.extend(candidates);
        Ok(())
    }
}
