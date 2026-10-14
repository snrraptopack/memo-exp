//! Per-document containment of native work during protected publication.

mod net;
mod shell;

use std::sync::{Arc, Mutex};

use blitz_dom::DocumentConfig;
use blitz_traits::net::{AbortController, DummyNetProvider, NetHandler, NetProvider, Request};
use blitz_traits::shell::{DummyShellProvider, ShellProvider};

use net::ControlledNet;
use shell::{ControlledShell, ShellChanges};

const MAX_QUEUED_RESOURCES: usize = 4_096;

struct Fetch {
    document: usize,
    request: Request,
    handler: Box<dyn NetHandler>,
}

#[derive(Default)]
struct Pending {
    depth: usize,
    resources: Vec<Fetch>,
    queued_resources: usize,
    shell: ShellChanges,
}

enum Phase {
    Idle,
    Held(Pending),
    Failed,
}

pub(crate) struct PublicationProviders {
    phase: Mutex<Phase>,
    net: Arc<dyn NetProvider>,
    shell: Mutex<Arc<dyn ShellProvider>>,
    owned_abort: Mutex<Option<AbortController>>,
}

impl PublicationProviders {
    pub fn install(config: &mut DocumentConfig) -> Arc<Self> {
        // A caller-supplied signal keeps its ownership and identity. Otherwise
        // document failure/disposal can signal abortion of already started work.
        let owned_abort = if config.abort_signal.is_none() {
            let controller = AbortController::default();
            config.abort_signal = Some(controller.signal.clone());
            Some(controller)
        } else {
            None
        };
        let providers = Arc::new(Self {
            phase: Mutex::new(Phase::Idle),
            net: config
                .net_provider
                .take()
                .unwrap_or_else(|| Arc::new(DummyNetProvider)),
            shell: Mutex::new(
                config
                    .shell_provider
                    .take()
                    .unwrap_or_else(|| Arc::new(DummyShellProvider)),
            ),
            owned_abort: Mutex::new(owned_abort),
        });
        config.net_provider = Some(Arc::new(ControlledNet(providers.clone())));
        config.shell_provider = Some(Arc::new(ControlledShell(providers.clone())));
        providers
    }

    pub fn begin(&self) {
        let mut phase = self.phase.lock().unwrap();
        match &mut *phase {
            Phase::Idle => {
                *phase = Phase::Held(Pending {
                    depth: 1,
                    ..Pending::default()
                })
            }
            Phase::Held(pending) => pending.depth += 1,
            Phase::Failed => panic!("desktop providers are closed"),
        }
    }

    pub fn finish(&self) {
        {
            let mut phase = self.phase.lock().unwrap();
            let Phase::Held(pending) = &mut *phase else {
                panic!("desktop provider boundary is not held")
            };
            pending.depth -= 1;
            if pending.depth > 0 {
                return;
            }
        }
        // Keep the phase held while dispatching. A synchronous resource callback
        // may queue imports or request redraw; do not deadlock or release early.
        loop {
            let work = {
                let mut phase = self.phase.lock().unwrap();
                let Phase::Held(pending) = &mut *phase else {
                    return;
                };
                if pending.resources.is_empty() {
                    let shell = std::mem::take(&mut pending.shell);
                    *phase = Phase::Idle;
                    drop(phase);
                    shell.release(self.shell_backend().as_ref());
                    return;
                }
                std::mem::take(&mut pending.resources)
            };
            for fetch in work {
                if !fetch
                    .request
                    .signal
                    .as_ref()
                    .is_some_and(|signal| signal.aborted())
                {
                    self.net.fetch(fetch.document, fetch.request, fetch.handler);
                }
            }
        }
    }

    /// Window attachment changes the backend, never the publication gate.
    #[cfg(any(feature = "window", test))]
    pub fn bind_shell(&self, backend: Arc<dyn ShellProvider>) {
        assert!(matches!(*self.phase.lock().unwrap(), Phase::Idle));
        *self.shell.lock().unwrap() = backend;
    }

    fn shell_backend(&self) -> Arc<dyn ShellProvider> {
        // Drop the lock before invoking platform callbacks, including reentrant
        // callbacks. The document thread owns attachment ordering.
        self.shell.lock().unwrap().clone()
    }

    pub fn fail(&self) {
        // Recover a poisoned lock on an invariant/overflow unwind. Release queued
        // handlers outside the lock; callbacks must never run under this mutex.
        let mut phase = self.phase.lock().unwrap_or_else(|error| error.into_inner());
        let discarded = std::mem::replace(&mut *phase, Phase::Failed);
        self.phase.clear_poison();
        drop(phase);
        drop(discarded);
        if let Some(controller) = self.owned_abort.lock().unwrap().take() {
            controller.abort();
        }
    }

    fn queue_shell(&self, update: impl FnOnce(&mut ShellChanges)) -> bool {
        let mut phase = self.phase.lock().unwrap();
        match &mut *phase {
            Phase::Idle => false,
            Phase::Held(pending) => {
                update(&mut pending.shell);
                true
            }
            Phase::Failed => true,
        }
    }

    fn interactive_allowed(&self) -> bool {
        let phase = self.phase.lock().unwrap();
        match &*phase {
            Phase::Idle => true,
            Phase::Held(_) => {
                panic!("interactive shell work cannot run during desktop publication")
            }
            Phase::Failed => false,
        }
    }
}

#[cfg(test)]
mod tests;
