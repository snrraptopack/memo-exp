//! Document ownership and publication are separate from style/layout resolution.

mod error;
mod identity;
mod instance;
mod lifetime;
mod mount;
mod mutations;
mod template;

use std::collections::HashMap;
use std::panic::{AssertUnwindSafe, catch_unwind};

use blitz_dom::{BaseDocument, DocumentConfig, NodeId, QualName, ns};

pub use error::DocumentError;
pub use identity::{MountTarget, NodeRef, Owner};
pub use mutations::Mutation;
pub use template::{SourceNode, Template, TemplateNode, ValidatedTemplate};

use instance::Instance;

/// The engine document is retained between accepted presentation updates.
pub struct NativeDocument {
    document: BaseDocument,
    body: NodeId,
    instances: HashMap<Owner, Instance>,
    /// Reverse boundary lookup avoids scanning unrelated instance records.
    owner_boundaries: HashMap<NodeId, Owner>,
    generations: HashMap<String, u64>,
    failed: bool,
}

impl NativeDocument {
    pub fn new(config: DocumentConfig) -> Self {
        let mut document = BaseDocument::new(config);
        let root = document.root_node().id;
        let body;
        {
            let mut mutation = document.mutate();
            let html = mutation.create_element(html_name("html"), Vec::new());
            let head = mutation.create_element(html_name("head"), Vec::new());
            body = mutation.create_element(html_name("body"), Vec::new());
            mutation.append_children(html, &[head, body]);
            mutation.append_children(root, &[html]);
        }
        Self {
            document,
            body,
            instances: HashMap::new(),
            owner_boundaries: HashMap::new(),
            generations: HashMap::new(),
            failed: false,
        }
    }

    pub fn engine(&self) -> &BaseDocument {
        &self.document
    }

    pub fn body(&self) -> NodeId {
        self.body
    }

    pub fn owner_count(&self) -> usize {
        self.instances.len()
    }

    pub fn is_failed(&self) -> bool {
        self.failed
    }

    pub fn node_id(&self, source: &NodeRef) -> Result<NodeId, DocumentError> {
        self.ensure_live()?;
        let instance = self
            .instances
            .get(&source.owner)
            .ok_or(DocumentError::UnknownOwner)?;
        let node = *instance
            .nodes
            .get(source.source as usize)
            .ok_or(DocumentError::UnknownSource)?;
        self.document
            .get_node(node)
            .ok_or(DocumentError::MissingEngineNode)?;
        Ok(node)
    }

    /// Structural acceptance does not imply a completed layout or painted frame.
    pub fn resolve(&mut self, animation_time: f64) -> Result<(), DocumentError> {
        self.ensure_live()?;
        self.apply(|host| host.document.resolve(animation_time))
    }

    fn ensure_live(&self) -> Result<(), DocumentError> {
        if self.failed {
            Err(DocumentError::FailedDocument)
        } else {
            Ok(())
        }
    }

    /// Validation happens before this boundary. An unwind cannot be reported as
    /// an atomic refusal: live mutations or provider work may already have run.
    fn apply<T>(&mut self, operation: impl FnOnce(&mut Self) -> T) -> Result<T, DocumentError> {
        self.failed = true;
        match catch_unwind(AssertUnwindSafe(|| operation(self))) {
            Ok(result) => {
                self.failed = false;
                Ok(result)
            }
            Err(_) => Err(DocumentError::ApplicationFailed),
        }
    }
}

pub fn html_name(name: &str) -> QualName {
    QualName::new(None, ns!(html), name.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unexpected_live_failure_is_terminal_and_does_not_claim_rollback() {
        let mut host = NativeDocument::new(DocumentConfig::default());
        let owner = Owner::new("App", 1);
        let template = ValidatedTemplate::new(Template {
            key: "failure".to_string(),
            nodes: vec![TemplateNode {
                parent: None,
                node: SourceNode::Text("before".to_string()),
            }],
        })
        .unwrap();
        host.mount(owner.clone(), &template, MountTarget::Body)
            .unwrap();
        let node = host.node_id(&owner.node(0)).unwrap();

        let result = host.apply(|host| {
            host.document
                .mutate()
                .set_node_text(node, "partially applied");
            panic!("simulate an unexpected failure after live application");
        });
        assert_eq!(result, Err(DocumentError::ApplicationFailed));
        assert!(host.is_failed());
        assert_eq!(
            host.engine().get_node(node).unwrap().text_content(),
            "partially applied"
        );
        assert_eq!(host.update(&[]), Err(DocumentError::FailedDocument));
        assert_eq!(host.resolve(0.0), Err(DocumentError::FailedDocument));
        assert_eq!(host.retire(&owner), Err(DocumentError::FailedDocument));
        assert_eq!(
            host.mount(Owner::new("other", 1), &template, MountTarget::Body),
            Err(DocumentError::FailedDocument)
        );
    }
}
