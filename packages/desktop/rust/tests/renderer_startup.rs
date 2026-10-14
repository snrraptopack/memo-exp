//! Compile the actual worker implementation and its lifecycle contracts in the
//! host test suite, without a second workspace or duplicate worker algorithm.
#![cfg(feature = "window")]

#[path = "../vendor/anyrender_vello/src/native_init.rs"]
mod native_init;
