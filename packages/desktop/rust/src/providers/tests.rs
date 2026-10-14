use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Weak;
use std::sync::atomic::{AtomicUsize, Ordering};

use blitz_traits::net::{Bytes, Url};
use blitz_traits::shell::ClipboardError;
use cursor_icon::CursorIcon;

use super::*;

struct EmptyHandler;
impl NetHandler for EmptyHandler {
    fn bytes(self: Box<Self>, _: String, _: Bytes) {}
}

fn request() -> Request {
    Request::get(Url::parse("https://assets.example/fixture.css").unwrap())
}

#[derive(Default)]
struct Shell {
    redraws: AtomicUsize,
    updates: Mutex<Vec<String>>,
}

impl ShellProvider for Shell {
    fn request_redraw(&self) {
        self.redraws.fetch_add(1, Ordering::SeqCst);
    }
    fn set_window_title(&self, title: String) {
        self.updates.lock().unwrap().push(title);
    }
    fn set_cursor(&self, _: Option<CursorIcon>) {
        self.updates.lock().unwrap().push("cursor".to_string());
    }
    fn set_ime_enabled(&self, enabled: bool) {
        self.updates.lock().unwrap().push(format!("ime:{enabled}"));
    }
    fn set_ime_cursor_area(&self, _: f32, _: f32, _: f32, _: f32) {
        self.updates.lock().unwrap().push("area".to_string());
    }
    fn get_clipboard_text(&self) -> Result<String, ClipboardError> {
        Ok("clipboard".to_string())
    }
    fn is_window_maximized(&self) -> bool {
        true
    }
}

#[derive(Default)]
struct Net {
    calls: AtomicUsize,
}
impl NetProvider for Net {
    fn fetch(&self, _: usize, _: Request, _: Box<dyn NetHandler>) {
        self.calls.fetch_add(1, Ordering::SeqCst);
    }
}

fn setup() -> (
    Arc<PublicationProviders>,
    DocumentConfig,
    Arc<Shell>,
    Arc<Net>,
) {
    let shell = Arc::new(Shell::default());
    let net = Arc::new(Net::default());
    let mut config = DocumentConfig {
        shell_provider: Some(shell.clone()),
        net_provider: Some(net.clone()),
        ..DocumentConfig::default()
    };
    let providers = PublicationProviders::install(&mut config);
    (providers, config, shell, net)
}

#[test]
fn nested_boundaries_release_only_when_the_outer_application_finishes() {
    let (providers, config, shell, net) = setup();
    providers.begin();
    providers.begin();
    config
        .net_provider
        .as_ref()
        .unwrap()
        .fetch(1, request(), Box::new(EmptyHandler));
    let controlled = config.shell_provider.as_ref().unwrap();
    controlled.set_window_title("first".to_string());
    controlled.set_window_title("last".to_string());
    controlled.request_redraw();
    controlled.request_redraw();
    providers.finish();
    assert_eq!(net.calls.load(Ordering::SeqCst), 0);
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
    assert!(shell.updates.lock().unwrap().is_empty());
    providers.finish();
    assert_eq!(net.calls.load(Ordering::SeqCst), 1);
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 1);
    assert_eq!(*shell.updates.lock().unwrap(), vec!["last"]);
}

#[test]
fn attaching_a_window_backend_keeps_publication_work_held() {
    let (providers, config, initial, _) = setup();
    let window = Arc::new(Shell::default());
    providers.bind_shell(window.clone());
    providers.begin();
    let shell = config.shell_provider.as_ref().unwrap();
    shell.request_redraw();
    shell.set_window_title("Accepted title".to_string());
    assert_eq!(window.redraws.load(Ordering::SeqCst), 0);
    assert!(window.updates.lock().unwrap().is_empty());
    providers.finish();
    assert_eq!(window.redraws.load(Ordering::SeqCst), 1);
    assert_eq!(*window.updates.lock().unwrap(), ["Accepted title"]);
    assert_eq!(initial.redraws.load(Ordering::SeqCst), 0);
    providers.fail();
    shell.request_redraw();
    assert_eq!(window.redraws.load(Ordering::SeqCst), 1);
}

#[test]
fn failure_discards_queued_requests_and_suppresses_late_provider_calls() {
    let (providers, config, shell, net) = setup();
    providers.begin();
    config
        .net_provider
        .as_ref()
        .unwrap()
        .fetch(1, request(), Box::new(EmptyHandler));
    config.shell_provider.as_ref().unwrap().request_redraw();
    providers.fail();
    config
        .net_provider
        .as_ref()
        .unwrap()
        .fetch(1, request(), Box::new(EmptyHandler));
    config.shell_provider.as_ref().unwrap().request_redraw();
    assert_eq!(net.calls.load(Ordering::SeqCst), 0);
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
    assert!(config.abort_signal.as_ref().unwrap().aborted());
}

#[test]
fn cursor_ime_and_live_queries_remain_real_forwarded_shell_capabilities() {
    let (providers, config, shell, _) = setup();
    let controlled = config.shell_provider.as_ref().unwrap();
    assert_eq!(
        controlled.get_clipboard_text().unwrap_or_default(),
        "clipboard"
    );
    assert!(controlled.is_window_maximized());
    providers.begin();
    controlled.set_cursor(Some(CursorIcon::Text));
    controlled.set_ime_enabled(true);
    controlled.set_ime_cursor_area(1.0, 2.0, 3.0, 4.0);
    assert!(shell.updates.lock().unwrap().is_empty());
    providers.finish();
    assert_eq!(
        *shell.updates.lock().unwrap(),
        vec!["cursor", "ime:true", "area"]
    );
}

#[test]
fn unexpected_scene_time_platform_read_is_fatal_without_lock_poison_escape() {
    let (providers, config, shell, _) = setup();
    providers.begin();
    assert!(
        catch_unwind(AssertUnwindSafe(|| config
            .shell_provider
            .as_ref()
            .unwrap()
            .is_window_maximized()))
        .is_err()
    );
    providers.fail();
    config.shell_provider.as_ref().unwrap().request_redraw();
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
}

#[test]
fn aborted_requests_do_not_start_and_noop_identity_is_preserved() {
    let (providers, config, _, net) = setup();
    let controller = AbortController::default();
    let request = request().signal(controller.signal.clone());
    providers.begin();
    config
        .net_provider
        .as_ref()
        .unwrap()
        .fetch(1, request, Box::new(EmptyHandler));
    controller.abort();
    providers.finish();
    assert_eq!(net.calls.load(Ordering::SeqCst), 0);
    assert!(!config.net_provider.as_ref().unwrap().is_noop());
    let mut dummy = DocumentConfig::default();
    PublicationProviders::install(&mut dummy);
    assert!(dummy.net_provider.as_ref().unwrap().is_noop());
}

#[derive(Default)]
struct ReentrantNet {
    calls: AtomicUsize,
    target: Mutex<Option<Weak<dyn NetProvider>>>,
    shell: Mutex<Option<Weak<dyn ShellProvider>>>,
    repeat: bool,
}

impl NetProvider for ReentrantNet {
    fn fetch(&self, document: usize, _: Request, _: Box<dyn NetHandler>) {
        let previous = self.calls.fetch_add(1, Ordering::SeqCst);
        if previous == 0 || self.repeat {
            self.target
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .upgrade()
                .unwrap()
                .fetch(document, request(), Box::new(EmptyHandler));
            self.shell
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .upgrade()
                .unwrap()
                .request_redraw();
        }
    }
}

fn reentrant(
    repeat: bool,
) -> (
    Arc<PublicationProviders>,
    DocumentConfig,
    Arc<ReentrantNet>,
    Arc<Shell>,
) {
    let net = Arc::new(ReentrantNet {
        repeat,
        ..ReentrantNet::default()
    });
    let shell = Arc::new(Shell::default());
    let mut config = DocumentConfig {
        net_provider: Some(net.clone()),
        shell_provider: Some(shell.clone()),
        ..DocumentConfig::default()
    };
    let providers = PublicationProviders::install(&mut config);
    *net.target.lock().unwrap() = Some(Arc::downgrade(config.net_provider.as_ref().unwrap()));
    *net.shell.lock().unwrap() = Some(Arc::downgrade(config.shell_provider.as_ref().unwrap()));
    (providers, config, net, shell)
}

#[test]
fn synchronous_resource_callbacks_can_queue_more_work_without_deadlock() {
    let (providers, config, net, shell) = reentrant(false);
    providers.begin();
    config
        .net_provider
        .as_ref()
        .unwrap()
        .fetch(1, request(), Box::new(EmptyHandler));
    providers.finish();
    assert_eq!(net.calls.load(Ordering::SeqCst), 2);
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 1);
}

#[test]
fn resource_budget_bounds_reentrant_dispatch_and_failure_recovers_poison() {
    let (providers, config, net, shell) = reentrant(true);
    providers.begin();
    config
        .net_provider
        .as_ref()
        .unwrap()
        .fetch(1, request(), Box::new(EmptyHandler));
    assert!(catch_unwind(AssertUnwindSafe(|| providers.finish())).is_err());
    providers.fail();
    config.shell_provider.as_ref().unwrap().request_redraw();
    assert_eq!(net.calls.load(Ordering::SeqCst), MAX_QUEUED_RESOURCES);
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
}
