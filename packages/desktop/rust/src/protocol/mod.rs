//! Ordered publication at the process boundary, independent of application state.
//!
//! The first packet family carries text/attribute write sets. Structural packets
//! will use the same sequence and acceptance boundary once their complete staged
//! topology validation exists. Unsupported operations are refused, never skipped.

mod error;
mod session;
mod wire;

pub use error::ProtocolError;
pub use session::{Acceptance, PublicationSession};
pub use wire::{MAX_PACKET_BYTES, MAX_WRITES, PROTOCOL_VERSION};
