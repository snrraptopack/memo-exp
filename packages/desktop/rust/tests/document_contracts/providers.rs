//! Real engine flushes must stay inside a complete publication boundary.

use super::{attribute, element, template, text};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use blitz_dom::DocumentConfig;
use blitz_traits::net::{AbortSignal, NetHandler, NetProvider, Request};
use blitz_traits::shell::ShellProvider;
use memoized_dom_desktop::document::{
    DocumentError, MountTarget, Mutation, NativeDocument, Operation, Owner,
};
use memoized_dom_desktop::protocol::PublicationSession;

#[derive(Default)]
struct RecordedShell {
    redraws: AtomicUsize,
    titles: Mutex<Vec<String>>,
}

impl ShellProvider for RecordedShell {
    fn request_redraw(&self) {
        self.redraws.fetch_add(1, Ordering::SeqCst);
    }
    fn set_window_title(&self, title: String) {
        self.titles.lock().unwrap().push(title);
    }
}

#[derive(Default)]
struct RecordedNet {
    requests: Mutex<Vec<(String, Option<AbortSignal>)>>,
}

impl NetProvider for RecordedNet {
    fn fetch(&self, _: usize, request: Request, _: Box<dyn NetHandler>) {
        self.requests
            .lock()
            .unwrap()
            .push((request.url.to_string(), request.signal));
    }
}

fn host() -> (NativeDocument, Arc<RecordedShell>, Arc<RecordedNet>) {
    let shell = Arc::new(RecordedShell::default());
    let net = Arc::new(RecordedNet::default());
    let document = NativeDocument::new(DocumentConfig {
        shell_provider: Some(shell.clone()),
        net_provider: Some(net.clone()),
        base_url: Some("https://assets.example/".to_string()),
        ..DocumentConfig::default()
    });
    shell.redraws.store(0, Ordering::SeqCst);
    (document, shell, net)
}

#[test]
fn mixed_native_flushes_release_one_redraw_and_only_the_final_title() {
    let (mut document, shell, net) = host();
    let owner = Owner::new("page", 1);
    let source = template(vec![
        element("title", vec![], None),
        text("initial", Some(0)),
        element("img", vec![attribute("src", "icon.png")], None),
    ]);
    document
        .transact(&[
            Operation::Mount {
                owner: owner.clone(),
                template: &source,
                target: MountTarget::Body,
            },
            Operation::Write(Mutation::Text {
                target: owner.node(1),
                value: "final".to_string(),
            }),
            Operation::MoveToEnd { owner },
        ])
        .unwrap();
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 1);
    assert_eq!(*shell.titles.lock().unwrap(), vec!["final"]);
    assert_eq!(
        net.requests.lock().unwrap()[0].0,
        "https://assets.example/icon.png"
    );
    assert_eq!(net.requests.lock().unwrap().len(), 1);
}

#[test]
fn late_refusal_starts_no_resources_and_publishes_no_platform_changes() {
    let (mut document, shell, net) = host();
    let owner = Owner::new("page", 1);
    let source = template(vec![
        element("title", vec![], None),
        text("candidate", Some(0)),
        element("img", vec![attribute("src", "candidate.png")], None),
    ]);
    assert_eq!(
        document.transact(&[
            Operation::Mount {
                owner: owner.clone(),
                template: &source,
                target: MountTarget::Body
            },
            Operation::Write(Mutation::Text {
                target: owner.node(99),
                value: "bad".to_string()
            }),
        ]),
        Err(DocumentError::UnknownSource)
    );
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
    assert!(shell.titles.lock().unwrap().is_empty());
    assert!(net.requests.lock().unwrap().is_empty());
}

#[test]
fn session_close_and_document_disposal_abort_owned_resource_signals() {
    let (mut document, _, net) = host();
    let source = template(vec![element(
        "img",
        vec![attribute("src", "image.png")],
        None,
    )]);
    document
        .mount(Owner::new("image", 1), &source, MountTarget::Body)
        .unwrap();
    let signal = net.requests.lock().unwrap()[0].1.clone().unwrap();
    assert!(!signal.aborted());
    let mut session = PublicationSession::new(document);
    session.close();
    assert!(signal.aborted());

    let (mut document, _, net) = host();
    document
        .mount(Owner::new("image", 1), &source, MountTarget::Body)
        .unwrap();
    let signal = net.requests.lock().unwrap()[0].1.clone().unwrap();
    drop(document);
    assert!(signal.aborted());
}

#[test]
fn supplied_abort_signal_stays_caller_owned_and_reaches_the_backend() {
    let controller = blitz_traits::net::AbortController::default();
    let signal = controller.signal.clone();
    let net = Arc::new(RecordedNet::default());
    let mut document = NativeDocument::new(DocumentConfig {
        net_provider: Some(net.clone()),
        abort_signal: Some(signal.clone()),
        base_url: Some("https://assets.example/".to_string()),
        ..DocumentConfig::default()
    });
    let source = template(vec![element(
        "img",
        vec![attribute("src", "image.png")],
        None,
    )]);
    document
        .mount(Owner::new("image", 1), &source, MountTarget::Body)
        .unwrap();
    let forwarded = net.requests.lock().unwrap()[0].1.clone().unwrap();
    drop(document);
    assert!(!forwarded.aborted());
    controller.abort();
    assert!(forwarded.aborted());
}
