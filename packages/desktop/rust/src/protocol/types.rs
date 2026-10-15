//! Wire identities and qualified names convert directly to native record types.

use blitz_dom::QualName;
use serde::Deserialize;

use crate::document::{MountTarget, NodeRef, Owner};

use super::ProtocolError;
use super::wire::MAX_SAFE_INTEGER;

const MAX_OWNER_BYTES: usize = 256;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct WireReference {
    owner: WireOwner,
    source: u32,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct WireOwner {
    id: String,
    generation: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct WireName {
    namespace: String,
    local: String,
    prefix: Option<String>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub(super) enum WireDestination {
    // An empty struct variant enforces unknown-field refusal. Serde's unit
    // variant would silently ignore fields after the internally tagged kind.
    Body {},
    Element { source: WireReference },
    Region { source: WireReference },
}

impl WireOwner {
    pub fn into_owner(self) -> Result<Owner, ProtocolError> {
        if self.id.is_empty()
            || self.id.len() > MAX_OWNER_BYTES
            || self.generation == 0
            || self.generation > MAX_SAFE_INTEGER
        {
            return Err(ProtocolError::InvalidIdentity);
        }
        Ok(Owner::new(self.id, self.generation))
    }
}

impl WireReference {
    pub fn into_reference(self) -> Result<NodeRef, ProtocolError> {
        Ok(self.owner.into_owner()?.node(self.source))
    }
}

impl WireName {
    pub fn into_qualified_name(self) -> QualName {
        QualName::new(
            self.prefix.map(Into::into),
            self.namespace.into(),
            self.local.into(),
        )
    }
}

impl WireDestination {
    pub fn into_destination(self) -> Result<MountTarget, ProtocolError> {
        match self {
            Self::Body {} => Ok(MountTarget::Body),
            Self::Element { source } => Ok(MountTarget::Element(source.into_reference()?)),
            Self::Region { source } => Ok(MountTarget::Region(source.into_reference()?)),
        }
    }
}
