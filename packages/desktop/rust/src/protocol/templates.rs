//! Immutable template declarations reuse the document's existing source validator.

use std::collections::HashMap;

use blitz_dom::Attribute;
use serde::Deserialize;

use crate::document::{SourceNode, Template, TemplateNode, ValidatedTemplate};

use super::ProtocolError;
use super::types::WireName;

pub(super) type TemplateRegistry = HashMap<String, ValidatedTemplate>;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct WireTemplate {
    key: String,
    nodes: Vec<WireTemplateNode>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireTemplateNode {
    parent: Option<u32>,
    node: WireSourceNode,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
enum WireSourceNode {
    Element {
        name: WireName,
        attributes: Vec<WireAttribute>,
    },
    Text {
        value: String,
    },
    Comment {
        value: String,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct WireAttribute {
    name: WireName,
    value: String,
}

pub(super) fn validate_declarations(
    declarations: Vec<WireTemplate>,
    accepted: &TemplateRegistry,
) -> Result<TemplateRegistry, ProtocolError> {
    let mut candidates = HashMap::with_capacity(declarations.len());
    for declaration in declarations {
        if accepted.contains_key(&declaration.key) || candidates.contains_key(&declaration.key) {
            return Err(ProtocolError::DuplicateTemplate(declaration.key));
        }
        let key = declaration.key.clone();
        let template = declaration.into_template()?;
        candidates.insert(key, template);
    }
    Ok(candidates)
}

impl WireTemplate {
    fn into_template(self) -> Result<ValidatedTemplate, ProtocolError> {
        let nodes = self
            .nodes
            .into_iter()
            .map(|source| TemplateNode {
                parent: source.parent,
                node: match source.node {
                    WireSourceNode::Element { name, attributes } => SourceNode::Element {
                        name: name.into_qualified_name(),
                        attributes: attributes
                            .into_iter()
                            .map(|attribute| Attribute {
                                name: attribute.name.into_qualified_name(),
                                value: attribute.value,
                            })
                            .collect(),
                    },
                    WireSourceNode::Text { value } => SourceNode::Text(value),
                    WireSourceNode::Comment { value } => SourceNode::Comment(value),
                },
            })
            .collect();
        ValidatedTemplate::new(Template {
            key: self.key,
            nodes,
        })
        .map_err(ProtocolError::Refused)
    }
}
