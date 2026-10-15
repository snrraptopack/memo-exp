//! The native event loop owns the existing document and publication driver.
//! Pipe workers wake it; layout, paint and input never wait for pipe I/O.

mod trace;
use trace::StartupTrace;

use std::any::Any;
use std::io;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::task::Context;

use anyrender_vello::{VelloRendererOptions, VelloWindowRenderer};
use blitz_dom::{DocGuard, DocGuardMut, Document, DocumentConfig};
use blitz_shell::{BlitzApplication, BlitzShellEvent, BlitzShellProxy, WindowConfig};
use blitz_traits::events::UiEvent;
use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::{StartCause, WindowEvent};
use winit::event_loop::ActiveEventLoop;
use winit::event_loop::ControlFlow;
use winit::window::{WindowAttributes, WindowId};

use crate::document::NativeDocument;
use crate::events::PendingDefaults;
use crate::protocol::EventSink;
use crate::protocol::{DriverStatus, ProcessDriver, PublicationSession};

struct HostWake;
struct GpuInitializationWake;

struct WindowDocument {
    driver: ProcessDriver,
    terminal: Arc<AtomicU8>,
    sink: EventSink,
    defaults: PendingDefaults,
    ready: bool,
    trace: StartupTrace,
    scene_accepted: bool,
}

impl WindowDocument {
    fn announce_ready(&mut self) {
        if self.ready {
            return;
        }
        match self.sink.ready() {
            Ok(()) => {
                self.ready = true;
                self.trace.mark("renderer_ready");
            }
            Err(failure) => {
                eprintln!("desktop startup {}: {}", failure.code, failure.message);
                self.driver.close();
                self.terminal.store(2, Ordering::Release);
            }
        }
    }
}

impl Document for WindowDocument {
    fn inner(&self) -> DocGuard<'_> {
        DocGuard::Ref(self.driver.session().document().engine())
    }

    fn inner_mut(&mut self) -> DocGuardMut<'_> {
        DocGuardMut::Ref(self.driver.session_mut().document_mut().engine_mut())
    }

    fn handle_ui_event(&mut self, event: UiEvent) {
        self.defaults.scene_sequence = self
            .driver
            .session()
            .expected_sequence()
            .unwrap_or(9_007_199_254_740_992)
            - 1;
        let defaults = &mut self.defaults;
        let sink = &self.sink;
        defaults.handle_ui_event(self.driver.session_mut().document_mut(), event, sink);
        if let Err(failure) = self.defaults.check_failure() {
            eprintln!("desktop interaction {}: {}", failure.code, failure.message);
            self.driver.close();
            self.terminal.store(2, Ordering::Release);
        }
    }

    fn poll(&mut self, _context: Option<Context>) -> bool {
        if self.terminal.load(Ordering::Acquire) != 0 {
            return false;
        }
        if let Err(failure) = self.defaults.check_failure() {
            eprintln!("desktop interaction {}: {}", failure.code, failure.message);
            self.driver.close();
            self.terminal.store(2, Ordering::Release);
            return false;
        }
        // Blitz attaches its window provider during View initialization. Restore
        // the existing publication gate before admitting the first scene packet.
        self.driver
            .session_mut()
            .document_mut()
            .attach_shell_provider();
        let before = self.driver.session().expected_sequence();
        let defaults = &mut self.defaults;
        let sink = &self.sink;
        match self
            .driver
            .poll_with_controls(|document, decision, sequence| {
                defaults.scene_sequence = sequence;
                defaults.decide(document, decision, sink)
            }) {
            DriverStatus::Running => {}
            DriverStatus::Finished => self.terminal.store(1, Ordering::Release),
            DriverStatus::Failed(failure) => {
                eprintln!("desktop connection {}: {}", failure.code, failure.message);
                self.terminal.store(2, Ordering::Release);
            }
        }
        if !self.scene_accepted && self.driver.session().document().owner_count() > 0 {
            self.scene_accepted = true;
            self.trace.mark("first_scene_accepted");
        }
        before != self.driver.session().expected_sequence()
    }
}

struct WindowApplication {
    shell: BlitzApplication<VelloWindowRenderer>,
    wake_pending: Arc<AtomicBool>,
    terminal: Arc<AtomicU8>,
    trace: StartupTrace,
    first_frame: bool,
}

impl WindowApplication {
    fn finish_if_terminal(&mut self, event_loop: &dyn ActiveEventLoop) -> bool {
        if self.terminal.load(Ordering::Acquire) == 0 {
            return false;
        }
        // Never paint a partially applied document after an unknown acceptance.
        self.shell.windows.clear();
        event_loop.exit();
        true
    }
}

impl ApplicationHandler for WindowApplication {
    fn can_create_surfaces(&mut self, event_loop: &dyn ActiveEventLoop) {
        self.trace.mark("window_renderer_init_begin");
        self.shell.can_create_surfaces(event_loop);
        self.trace.mark("window_renderer_init_end");
        for window in self.shell.windows.values_mut() {
            // Scene admission does not depend on asynchronous GPU readiness.
            // The first renderer frame will use this already accepted document.
            if window.doc.poll(None) {
                window.request_redraw();
            }
            self.shell.proxy.send_event(BlitzShellEvent::Poll {
                window_id: window.window_id(),
            });
        }
    }

    fn destroy_surfaces(&mut self, event_loop: &dyn ActiveEventLoop) {
        self.shell.destroy_surfaces(event_loop);
    }

    fn new_events(&mut self, event_loop: &dyn ActiveEventLoop, cause: StartCause) {
        if matches!(cause, StartCause::ResumeTimeReached { .. }) {
            for window in self.shell.windows.values_mut() {
                if window.doc.poll(None) {
                    window.request_redraw();
                }
            }
            self.finish_if_terminal(event_loop);
        }
    }

    fn about_to_wait(&mut self, event_loop: &dyn ActiveEventLoop) {
        let deadline = self
            .shell
            .windows
            .values()
            .filter_map(|window| {
                (&*window.doc as &dyn Any)
                    .downcast_ref::<WindowDocument>()?
                    .defaults
                    .next_deadline()
            })
            .min();
        event_loop.set_control_flow(match deadline {
            Some(deadline) => ControlFlow::WaitUntil(deadline),
            None => ControlFlow::Wait,
        });
    }

    fn window_event(&mut self, event_loop: &dyn ActiveEventLoop, id: WindowId, event: WindowEvent) {
        if self.finish_if_terminal(event_loop) {
            return;
        }
        let content_frame = !self.first_frame
            && matches!(event, WindowEvent::RedrawRequested)
            && self.shell.windows.get(&id).is_some_and(|window| {
                window.is_visible
                    && (&*window.doc as &dyn Any)
                        .downcast_ref::<WindowDocument>()
                        .is_some_and(|document| document.ready && document.scene_accepted)
                    && !window.doc.inner().has_pending_critical_resources()
            });
        if content_frame {
            self.trace.mark("first_content_frame_begin");
        }
        self.shell.window_event(event_loop, id, event);
        if content_frame
            && self
                .shell
                .windows
                .get(&id)
                .is_some_and(|window| window.renderer.frame_submitted())
        {
            // Blitz resolves and submits this visible, unblocked frame inside
            // its redraw handler. This measures submission, not scanout pixels.
            self.first_frame = true;
            self.trace.mark("first_content_frame_submitted");
        }
    }

    #[cfg(target_os = "macos")]
    fn macos_handler(
        &mut self,
    ) -> Option<&mut dyn winit::platform::macos::ApplicationHandlerExtMacOS> {
        self.shell.macos_handler()
    }

    fn proxy_wake_up(&mut self, event_loop: &dyn ActiveEventLoop) {
        while let Ok(event) = self.shell.event_queue.try_recv() {
            if matches!(&event, BlitzShellEvent::Embedder(value) if value.is::<GpuInitializationWake>())
            {
                for window in self.shell.windows.values_mut() {
                    if let Err(error) = window.renderer.notify_initialization_ready() {
                        eprintln!("desktop GPU initialization failed: {error}");
                        if let Some(document) =
                            (&mut *window.doc as &mut dyn Any).downcast_mut::<WindowDocument>()
                        {
                            document.driver.close();
                        }
                        self.terminal.store(2, Ordering::Release);
                    }
                }
            } else if matches!(&event, BlitzShellEvent::Embedder(value) if value.is::<HostWake>()) {
                self.wake_pending.store(false, Ordering::Release);
                for window in self.shell.windows.values_mut() {
                    if window.doc.poll(None) {
                        window.request_redraw();
                    }
                }
            } else {
                let resumed_window = match &event {
                    BlitzShellEvent::ResumeReady { window_id } => Some(*window_id),
                    _ => None,
                };
                self.shell.handle_blitz_shell_event(event_loop, event);
                if let Some(id) = resumed_window
                    && let Some(window) = self.shell.windows.get_mut(&id)
                {
                    // Blitz has completed renderer resume and installed its
                    // document waker. Startup readiness is independent of
                    // publication acceptance or a measured first paint.
                    if let Some(document) =
                        (&mut *window.doc as &mut dyn Any).downcast_mut::<WindowDocument>()
                    {
                        document.announce_ready();
                    }
                    window.request_redraw();
                }
            }
            if self.finish_if_terminal(event_loop) {
                return;
            }
        }
    }
}

/// Graphical mode is cross-platform; the Cargo feature is named `window`, not
/// Windows. The same executable retains --headless for process contracts.
pub fn run(mount_target: &str) -> Result<(), Box<dyn std::error::Error>> {
    let trace = StartupTrace::new();
    trace.mark("host_started");
    let event_loop = blitz_shell::create_default_event_loop();
    trace.mark("event_loop_created");
    let (proxy, events) = BlitzShellProxy::new(event_loop.create_proxy());
    let wake_pending = Arc::new(AtomicBool::new(false));
    let terminal = Arc::new(AtomicU8::new(0));
    let wake_proxy = proxy.clone();
    let pending = wake_pending.clone();
    let wake = Arc::new(move || {
        if !pending.swap(true, Ordering::AcqRel) {
            wake_proxy.send_event(BlitzShellEvent::embedder_event(HostWake));
        }
    });

    let mut native = NativeDocument::new(DocumentConfig::default());
    trace.mark("document_fonts_created");
    native.configure_mount(mount_target);
    let session = PublicationSession::new(native);
    let driver = ProcessDriver::start(session, io::stdin(), io::stdout(), wake)?;
    trace.mark("workers_started");
    let sink = driver.event_sink();
    let document = WindowDocument {
        driver,
        terminal: terminal.clone(),
        sink,
        defaults: PendingDefaults::new(),
        ready: false,
        trace,
        scene_accepted: false,
    };
    let mut shell = BlitzApplication::new(proxy, events);
    let graphics_proxy = shell.proxy.clone();
    let renderer = VelloWindowRenderer::with_options(VelloRendererOptions::default().startup_wake(
        Arc::new(move || {
            graphics_proxy.send_event(BlitzShellEvent::embedder_event(GpuInitializationWake));
        }),
    ));
    trace.mark("renderer_context_created");
    shell.add_window(WindowConfig::with_attributes(
        Box::new(document),
        renderer,
        WindowAttributes::default()
            .with_title("Memoized DOM Desktop")
            .with_surface_size(LogicalSize::new(960.0, 720.0)),
    ));
    let application = WindowApplication {
        shell,
        wake_pending,
        terminal: terminal.clone(),
        trace,
        first_frame: false,
    };
    event_loop.run_app(application)?;
    if terminal.load(Ordering::Acquire) == 2 {
        return Err("Native document connection failed".into());
    }
    Ok(())
}
