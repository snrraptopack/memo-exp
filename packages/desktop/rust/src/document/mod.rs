//! Document ownership and publication are separate from style/layout resolution.

mod error;
#[cfg(feature = "window")]
mod events;
mod identity;
mod input;
mod instance;
mod lifetime;
mod mount;
mod mutations;
mod template;
mod transaction;

use std::collections::HashMap;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;

use blitz_dom::{BaseDocument, DocumentConfig, NodeId, QualName, ns};
#[cfg(feature = "window")]
use blitz_traits::shell::ShellProvider;

pub use error::DocumentError;
pub use identity::{MountTarget, NodeRef, Owner};
#[cfg(feature = "window")]
pub(crate) use input::ControlState;
pub(crate) use input::EditorRevision;
pub use mutations::Mutation;
pub use template::{SourceNode, Template, TemplateNode, ValidatedTemplate};
pub use transaction::Operation;

use crate::providers::PublicationProviders;
use instance::Instance;

/// The engine document is retained between accepted presentation updates.
pub struct NativeDocument {
    document: BaseDocument,
    body: NodeId,
    instances: HashMap<Owner, Instance>,
    /// Reverse boundary lookup avoids scanning unrelated instance records.
    owner_boundaries: HashMap<NodeId, Owner>,
    #[cfg(feature = "window")]
    source_nodes: HashMap<NodeId, NodeRef>,
    generations: HashMap<String, u64>,
    editor_revisions: HashMap<NodeId, EditorRevision>,
    failed: bool,
    providers: Arc<PublicationProviders>,
    #[cfg(feature = "window")]
    controlled_shell: Arc<dyn ShellProvider>,
    #[cfg(feature = "window")]
    mount_container: Option<NodeId>,
}

impl NativeDocument {
    pub fn new(mut config: DocumentConfig) -> Self {
        let providers = PublicationProviders::install(&mut config);
        let mut document = BaseDocument::new(config);
        #[cfg(feature = "window")]
        let controlled_shell = document.shell_provider.clone();
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
            #[cfg(feature = "window")]
            source_nodes: HashMap::new(),
            generations: HashMap::new(),
            editor_revisions: HashMap::new(),
            failed: false,
            providers,
            #[cfg(feature = "window")]
            controlled_shell,
            #[cfg(feature = "window")]
            mount_container: None,
        }
    }

    pub fn engine(&self) -> &BaseDocument {
        &self.document
    }

    pub fn body(&self) -> NodeId {
        self.body
    }

    #[cfg(feature = "window")]
    pub(crate) fn configure_mount(&mut self, target: &str) {
        // The generated shell has one actual HTML mount container. It is not
        // part of an application owner; accepted root retirement leaves it live.
        let mut mutation = self.document.mutate();
        let node = mutation.create_element(
            html_name("div"),
            vec![blitz_dom::Attribute {
                name: QualName::new(None, ns!(), "id".into()),
                value: target.to_string(),
            }],
        );
        mutation.append_children(self.body, &[node]);
        self.mount_container = Some(node);
    }

    fn mount_parent(&self) -> NodeId {
        #[cfg(feature = "window")]
        if let Some(container) = self.mount_container {
            return container;
        }
        self.body
    }

    /// Engine access is restricted to the owning shell adapter. Publications
    /// still go through validation; native layout/input use Blitz's own APIs.
    #[cfg(feature = "window")]
    pub(crate) fn engine_mut(&mut self) -> &mut BaseDocument {
        self.attach_shell_provider();
        &mut self.document
    }

    #[cfg(feature = "window")]
    pub(crate) fn attach_shell_provider(&mut self) {
        if !Arc::ptr_eq(&self.document.shell_provider, &self.controlled_shell) {
            self.providers
                .bind_shell(self.document.shell_provider.clone());
            self.document
                .set_shell_provider(self.controlled_shell.clone());
        }
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
        // A prepared transaction reuses inner operation guards. Preserve a
        // failure recorded by an inner guard when the outer closure returns;
        // exclusive document ownership prevents concurrent access during work.
        match catch_unwind(AssertUnwindSafe(|| {
            self.providers.begin();
            let result = operation(self);
            if self.failed {
                self.providers.fail();
                return Err(DocumentError::ApplicationFailed);
            }
            self.providers.finish();
            Ok(result)
        })) {
            Ok(result) => result,
            Err(_) => {
                self.failed = true;
                self.providers.fail();
                Err(DocumentError::ApplicationFailed)
            }
        }
    }

    pub(crate) fn cancel_provider_work(&self) {
        self.providers.fail();
    }
}

impl Drop for NativeDocument {
    fn drop(&mut self) {
        self.providers.fail();
    }
}

pub fn html_name(name: &str) -> QualName {
    QualName::new(None, ns!(html), name.into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use blitz_dom::Attribute;
    use blitz_traits::net::{NetHandler, NetProvider, Request};
    use blitz_traits::shell::ShellProvider;
    use std::sync::atomic::{AtomicUsize, Ordering};

    #[derive(Default)]
    struct ProviderProbe {
        fetches: AtomicUsize,
        redraws: AtomicUsize,
        titles: AtomicUsize,
    }

    impl NetProvider for ProviderProbe {
        fn fetch(&self, _: usize, _: Request, _: Box<dyn NetHandler>) {
            self.fetches.fetch_add(1, Ordering::SeqCst);
        }
    }

    impl ShellProvider for ProviderProbe {
        fn request_redraw(&self) {
            self.redraws.fetch_add(1, Ordering::SeqCst);
        }
        fn set_window_title(&self, _: String) {
            self.titles.fetch_add(1, Ordering::SeqCst);
        }
    }

    #[test]
    fn unwind_after_real_nested_mount_discards_all_candidate_provider_work() {
        let probe = Arc::new(ProviderProbe::default());
        let mut host = NativeDocument::new(DocumentConfig {
            net_provider: Some(probe.clone()),
            shell_provider: Some(probe.clone()),
            base_url: Some("https://assets.example/".to_string()),
            ..DocumentConfig::default()
        });
        probe.redraws.store(0, Ordering::SeqCst);
        let template = ValidatedTemplate::new(Template {
            key: "failed-resources".to_string(),
            nodes: vec![
                TemplateNode {
                    parent: None,
                    node: SourceNode::Element {
                        name: html_name("title"),
                        attributes: vec![],
                    },
                },
                TemplateNode {
                    parent: Some(0),
                    node: SourceNode::Text("candidate".to_string()),
                },
                TemplateNode {
                    parent: None,
                    node: SourceNode::Element {
                        name: html_name("img"),
                        attributes: vec![Attribute {
                            name: QualName::new(None, ns!(), "src".into()),
                            value: "candidate.png".to_string(),
                        }],
                    },
                },
            ],
        })
        .unwrap();
        let result = host.apply(|host| {
            host.mount(Owner::new("candidate", 1), &template, MountTarget::Body)
                .unwrap();
            assert_eq!(probe.fetches.load(Ordering::SeqCst), 0);
            assert_eq!(probe.redraws.load(Ordering::SeqCst), 0);
            panic!("unexpected failure after a candidate mount");
        });
        assert_eq!(result, Err(DocumentError::ApplicationFailed));
        assert!(host.is_failed());
        assert_eq!(
            host.engine().get_node(host.body()).unwrap().text_content(),
            "candidate"
        );
        assert_eq!(probe.fetches.load(Ordering::SeqCst), 0);
        assert_eq!(probe.titles.load(Ordering::SeqCst), 0);
        assert_eq!(probe.redraws.load(Ordering::SeqCst), 0);
    }

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
