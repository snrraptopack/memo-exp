use std::fmt;

use crate::document::DocumentError;

#[derive(Debug, Eq, PartialEq)]
pub enum ProtocolError {
    PacketTooLarge,
    Decode(String),
    UnsupportedVersion { received: u32 },
    TooManyWrites,
    DuplicateTemplate(String),
    UnknownTemplate(String),
    InvalidSequence,
    InvalidIdentity,
    OutOfOrder { expected: u64, received: u64 },
    Refused(DocumentError),
    SequenceExhausted,
    AcceptanceUnknown,
    AcknowledgmentFailed(String),
    Closed,
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, output: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PacketTooLarge => write!(output, "desktop publication exceeds the byte limit"),
            Self::Decode(reason) => write!(output, "invalid desktop publication: {reason}"),
            Self::UnsupportedVersion { received } => {
                write!(output, "unsupported desktop protocol version {received}")
            }
            Self::TooManyWrites => {
                write!(output, "desktop publication exceeds the operation limit")
            }
            Self::DuplicateTemplate(key) => {
                write!(output, "desktop template {key:?} is already declared")
            }
            Self::UnknownTemplate(key) => {
                write!(output, "desktop template {key:?} is not declared")
            }
            Self::InvalidSequence => {
                write!(output, "desktop sequence must be a positive safe integer")
            }
            Self::InvalidIdentity => write!(output, "desktop source identity is invalid"),
            Self::OutOfOrder { expected, received } => {
                write!(
                    output,
                    "desktop sequence {received} arrived; expected {expected}"
                )
            }
            Self::Refused(reason) => write!(output, "desktop publication refused: {reason}"),
            Self::SequenceExhausted => write!(output, "desktop sequence capacity is exhausted"),
            Self::AcceptanceUnknown => write!(
                output,
                "desktop acceptance is unknown; close the connection and fail pending work"
            ),
            Self::AcknowledgmentFailed(reason) => write!(
                output,
                "desktop acknowledgment failed; acceptance is unknown: {reason}"
            ),
            Self::Closed => write!(output, "desktop publication connection is closed"),
        }
    }
}

impl std::error::Error for ProtocolError {}
