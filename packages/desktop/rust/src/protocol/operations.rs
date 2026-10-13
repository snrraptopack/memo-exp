//! Packet operations become the same records consumed by native transactions.

use serde::Deserialize;

use crate::document::{Mutation, Operation};

use super::ProtocolError;
use super::templates::TemplateRegistry;
use super::types::{WireDestination, WireName, WireOwner, WireReference};

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase", deny_unknown_fields)]
pub(super) enum WireOperation {
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
    Mount {
        owner: WireOwner,
        template: String,
        target: WireDestination,
    },
    MoveBefore {
        owner: WireOwner,
        before: WireOwner,
    },
    MoveToEnd {
        owner: WireOwner,
    },
    Retire {
        owner: WireOwner,
    },
}

impl WireOperation {
    pub fn into_operation<'template>(
        self,
        accepted: &'template TemplateRegistry,
        candidates: &'template TemplateRegistry,
    ) -> Result<Operation<'template>, ProtocolError> {
        match self {
            Self::Text { target, value } => Ok(Operation::Write(Mutation::Text {
                target: target.into_reference()?,
                value,
            })),
            Self::SetAttribute {
                target,
                name,
                value,
            } => Ok(Operation::Write(Mutation::Attribute {
                target: target.into_reference()?,
                name: name.into_qualified_name(),
                value: Some(value),
            })),
            Self::RemoveAttribute { target, name } => Ok(Operation::Write(Mutation::Attribute {
                target: target.into_reference()?,
                name: name.into_qualified_name(),
                value: None,
            })),
            Self::Mount {
                owner,
                template,
                target,
            } => {
                let declaration = candidates
                    .get(&template)
                    .or_else(|| accepted.get(&template))
                    .ok_or(ProtocolError::UnknownTemplate(template))?;
                Ok(Operation::Mount {
                    owner: owner.into_owner()?,
                    template: declaration,
                    target: target.into_destination()?,
                })
            }
            Self::MoveBefore { owner, before } => Ok(Operation::MoveBefore {
                owner: owner.into_owner()?,
                before: before.into_owner()?,
            }),
            Self::MoveToEnd { owner } => Ok(Operation::MoveToEnd {
                owner: owner.into_owner()?,
            }),
            Self::Retire { owner } => Ok(Operation::Retire {
                owner: owner.into_owner()?,
            }),
        }
    }
}
