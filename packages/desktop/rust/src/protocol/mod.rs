//! Ordered publication at the process boundary, independent of application state.
//!
//! Immutable templates and complete operation batches use one acceptance boundary.
//! Unsupported operations are refused, never skipped.

mod error;
mod operations;
mod session;
mod templates;
mod types;
mod wire;

pub use error::ProtocolError;
pub use session::{Acceptance, PublicationSession};
pub use wire::{MAX_OPERATIONS, MAX_PACKET_BYTES, MAX_WRITES, PROTOCOL_VERSION};
