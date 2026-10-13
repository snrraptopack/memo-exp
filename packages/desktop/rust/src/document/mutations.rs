use blitz_dom::{NodeData, NodeId, QualName};

use super::template::valid_name;
use super::{DocumentError, NativeDocument, NodeRef, SourceNode};

/// These are presentation writes, not application expressions or state cells.
#[derive(Debug)]
pub enum Mutation {
    Text {
        target: NodeRef,
        value: String,
    },
    Attribute {
        target: NodeRef,
        name: QualName,
        value: Option<String>,
    },
}

enum PreparedMutation<'value> {
    Text(NodeId, &'value str),
    Attribute(NodeId, &'value QualName, Option<&'value str>),
}

/// Source node kinds are shared by live and candidate validation. They contain
/// no presentation state: style/layout and the actual tree remain in Blitz.
#[derive(Clone, Copy, Eq, PartialEq)]
pub(super) enum SourceKind {
    Element,
    Text,
    Comment,
    Other,
}

impl From<&SourceNode> for SourceKind {
    fn from(node: &SourceNode) -> Self {
        match node {
            SourceNode::Element { .. } => Self::Element,
            SourceNode::Text(_) => Self::Text,
            SourceNode::Comment(_) => Self::Comment,
        }
    }
}

impl From<&NodeData> for SourceKind {
    fn from(node: &NodeData) -> Self {
        match node {
            NodeData::Element(_) => Self::Element,
            NodeData::Text(_) => Self::Text,
            NodeData::Comment { .. } => Self::Comment,
            _ => Self::Other,
        }
    }
}

impl Mutation {
    pub(super) fn target(&self) -> &NodeRef {
        match self {
            Self::Text { target, .. } | Self::Attribute { target, .. } => target,
        }
    }

    pub(super) fn validate_name(&self) -> Result<(), DocumentError> {
        if let Self::Attribute { target, name, .. } = self
            && !valid_name(&name.local)
        {
            return Err(DocumentError::InvalidTemplate {
                source: Some(target.source as usize),
                reason: "attribute name is invalid",
            });
        }
        Ok(())
    }

    pub(super) fn validate_kind(&self, kind: SourceKind) -> Result<(), DocumentError> {
        let required = match self {
            Self::Text { .. } => SourceKind::Text,
            Self::Attribute { .. } => SourceKind::Element,
        };
        if kind != required {
            return Err(DocumentError::WrongNodeKind);
        }
        Ok(())
    }
}

impl NativeDocument {
    /// Validate the whole write set first. A later bad reference cannot leave
    /// earlier text, styles, IDs or native control values partially changed.
    pub fn update(&mut self, writes: &[Mutation]) -> Result<(), DocumentError> {
        self.update_iter(writes.iter())
    }

    /// Mixed transactions group adjacent writes through the same preparation
    /// and mutator path, without copying values or flushing every destination.
    pub(super) fn update_iter<'value>(
        &mut self,
        writes: impl Iterator<Item = &'value Mutation>,
    ) -> Result<(), DocumentError> {
        self.ensure_live()?;
        let prepared = writes
            .map(|write| self.prepare_write(write))
            .collect::<Result<Vec<_>, _>>()?;

        if prepared.is_empty() {
            return Ok(());
        }
        self.apply(|host| {
            let mut mutation = host.document.mutate();
            for write in prepared {
                match write {
                    PreparedMutation::Text(node, text) => mutation.set_node_text(node, text),
                    PreparedMutation::Attribute(node, name, Some(value)) => {
                        mutation.set_attribute(node, name.clone(), value);
                    }
                    PreparedMutation::Attribute(node, name, None) => {
                        mutation.clear_attribute(node, name.clone());
                    }
                }
            }
        })
    }

    fn prepare_write<'value>(
        &self,
        write: &'value Mutation,
    ) -> Result<PreparedMutation<'value>, DocumentError> {
        write.validate_name()?;
        let id = self.node_id(write.target())?;
        let node = self
            .document
            .get_node(id)
            .ok_or(DocumentError::MissingEngineNode)?;
        write.validate_kind(SourceKind::from(&node.data))?;
        match write {
            Mutation::Text { value, .. } => Ok(PreparedMutation::Text(id, value)),
            Mutation::Attribute { name, value, .. } => {
                Ok(PreparedMutation::Attribute(id, name, value.as_deref()))
            }
        }
    }
}
