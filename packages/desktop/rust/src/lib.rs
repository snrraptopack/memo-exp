//! Native presentation for the existing compiler and JavaScript semantic runtime.
//!
//! This crate drives a retained Blitz document. It does not evaluate application
//! expressions, own reactive cells, or implement a second dependency graph.

pub mod document;
#[cfg(feature = "window")]
mod events;
pub mod protocol;
mod providers;
#[cfg(feature = "window")]
pub mod window;
