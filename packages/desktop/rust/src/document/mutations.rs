use blitz_dom::{NodeData, NodeId, QualName};

use super::template::valid_name;
use super::{DocumentError, NativeDocument, NodeRef};

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

impl NativeDocument {
    /// Validate the whole write set first. A later bad reference cannot leave
    /// earlier text, styles, IDs or native control values partially changed.
    pub fn update(&mut self, writes: &[Mutation]) -> Result<(), DocumentError> {
        self.ensure_live()?;
        let prepared = writes
            .iter()
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
        match write {
            Mutation::Text { target, value } => {
                let id = self.node_id(target)?;
                let node = self
                    .document
                    .get_node(id)
                    .ok_or(DocumentError::MissingEngineNode)?;
                if !matches!(node.data, NodeData::Text(_)) {
                    return Err(DocumentError::WrongNodeKind);
                }
                Ok(PreparedMutation::Text(id, value))
            }
            Mutation::Attribute {
                target,
                name,
                value,
            } => {
                if !valid_name(&name.local) {
                    return Err(DocumentError::InvalidTemplate {
                        source: Some(target.source as usize),
                        reason: "attribute name is invalid",
                    });
                }
                let id = self.node_id(target)?;
                let node = self
                    .document
                    .get_node(id)
                    .ok_or(DocumentError::MissingEngineNode)?;
                if !matches!(node.data, NodeData::Element(_)) {
                    return Err(DocumentError::WrongNodeKind);
                }
                Ok(PreparedMutation::Attribute(id, name, value.as_deref()))
            }
        }
    }
}
