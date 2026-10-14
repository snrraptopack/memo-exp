//! Ordered publication at the process boundary, independent of application state.
//!
//! Immutable templates and complete operation batches use one acceptance boundary.
//! Unsupported operations are refused, never skipped.

mod driver;
mod error;
mod framing;
mod operations;
mod reply;
mod session;
mod templates;
mod types;
mod wire;

#[cfg(feature = "window")]
pub(crate) use driver::EventSink;
pub use driver::{ConnectionFailure, DriverStatus, ProcessDriver, QUEUE_CAPACITY};
pub use error::ProtocolError;
pub use framing::{FrameError, FrameReader, FrameWriter};
pub use reply::PublicationReply;
pub use session::{Acceptance, PublicationSession};
pub use wire::{MAX_OPERATIONS, MAX_PACKET_BYTES, MAX_WRITES, PROTOCOL_VERSION};
