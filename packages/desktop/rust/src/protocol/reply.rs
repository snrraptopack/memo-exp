//! Responses describe structural acceptance, never a painted frame.

use serde::Serialize;

use super::{Acceptance, PROTOCOL_VERSION, ProtocolError};

/// A refusal names the expected slot, not a sequence guessed from invalid JSON.
/// A client must serialize publications and associate this response with its
/// outstanding request. Only an accepted reply advances its publication order.
#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum PublicationReply {
    Accepted(Acceptance),
    Rejected {
        version: u32,
        status: &'static str,
        #[serde(rename = "expectedSequence")]
        expected_sequence: Option<u64>,
        code: &'static str,
        message: String,
    },
}

impl PublicationReply {
    pub(super) fn rejected(error: &ProtocolError, expected_sequence: Option<u64>) -> Self {
        let (status, code) = match error {
            ProtocolError::PacketTooLarge => ("refused", "packetTooLarge"),
            ProtocolError::Decode(_) => ("refused", "decode"),
            ProtocolError::UnsupportedVersion { .. } => ("refused", "unsupportedVersion"),
            ProtocolError::TooManyWrites => ("refused", "tooManyOperations"),
            ProtocolError::DuplicateTemplate(_) => ("refused", "duplicateTemplate"),
            ProtocolError::UnknownTemplate(_) => ("refused", "unknownTemplate"),
            ProtocolError::InvalidSequence => ("refused", "invalidSequence"),
            ProtocolError::InvalidIdentity => ("refused", "invalidIdentity"),
            ProtocolError::OutOfOrder { .. } => ("refused", "outOfOrder"),
            ProtocolError::Refused(_) => ("refused", "documentRefused"),
            ProtocolError::SequenceExhausted => ("fatal", "sequenceExhausted"),
            ProtocolError::AcceptanceUnknown => ("fatal", "acceptanceUnknown"),
            ProtocolError::AcknowledgmentFailed(_) => ("fatal", "acknowledgmentFailed"),
            ProtocolError::Closed => ("fatal", "closed"),
        };
        Self::Rejected {
            version: PROTOCOL_VERSION,
            status,
            expected_sequence,
            code,
            // Template keys and decode diagnostics come from untrusted input.
            // Bound the wire diagnostic; machine decisions use the stable code.
            message: error.to_string().chars().take(512).collect(),
        }
    }

    pub(super) fn is_fatal(&self) -> bool {
        matches!(
            self,
            Self::Rejected {
                status: "fatal",
                ..
            }
        )
    }
}
