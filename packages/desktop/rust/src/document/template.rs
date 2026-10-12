//! Immutable source templates are validated before any native allocation.

use std::collections::HashSet;

use blitz_dom::{Attribute, QualName};

use super::DocumentError;

#[derive(Clone, Debug)]
pub enum SourceNode {
    Element {
        name: QualName,
        attributes: Vec<Attribute>,
    },
    Text(String),
    Comment(String),
}

#[derive(Clone, Debug)]
pub struct TemplateNode {
    /// Parents precede children; `None` identifies an authored fragment root.
    pub parent: Option<u32>,
    pub node: SourceNode,
}

#[derive(Clone, Debug)]
pub struct Template {
    pub key: String,
    pub nodes: Vec<TemplateNode>,
}

/// Fields stay private so callers cannot mutate an already validated template.
#[derive(Debug)]
pub struct ValidatedTemplate {
    pub(crate) template: Template,
    pub(crate) roots: Vec<u32>,
}

impl ValidatedTemplate {
    pub fn new(template: Template) -> Result<Self, DocumentError> {
        if template.key.is_empty() {
            return Err(DocumentError::InvalidTemplate {
                source: None,
                reason: "template key is empty",
            });
        }
        if template.nodes.len() > u32::MAX as usize {
            return Err(DocumentError::InvalidTemplate {
                source: None,
                reason: "template exceeds source index capacity",
            });
        }

        let mut roots = Vec::new();
        for (index, source) in template.nodes.iter().enumerate() {
            let refuse = |reason| DocumentError::InvalidTemplate {
                source: Some(index),
                reason,
            };
            if let Some(parent) = source.parent {
                if parent as usize >= index {
                    return Err(refuse("parent must precede its child"));
                }
                if !matches!(
                    template.nodes[parent as usize].node,
                    SourceNode::Element { .. }
                ) {
                    return Err(refuse("only elements can contain source children"));
                }
            } else {
                roots.push(index as u32);
            }

            if let SourceNode::Element { name, attributes } = &source.node {
                if !valid_name(&name.local) {
                    return Err(refuse("element name is invalid"));
                }
                let mut names = HashSet::new();
                for attribute in attributes {
                    if !valid_name(&attribute.name.local) {
                        return Err(refuse("attribute name is invalid"));
                    }
                    if !names.insert((&attribute.name.ns, &attribute.name.local)) {
                        return Err(refuse("attribute name is repeated"));
                    }
                }
            }
        }
        Ok(Self { template, roots })
    }

    pub fn key(&self) -> &str {
        &self.template.key
    }

    pub fn source_count(&self) -> usize {
        self.template.nodes.len()
    }
}

pub(crate) fn valid_name(name: &str) -> bool {
    !name.is_empty()
        && !name.chars().any(|character| {
            character.is_whitespace()
                || character.is_control()
                || matches!(character, '<' | '>' | '/' | '=' | '"' | '\'')
        })
}
