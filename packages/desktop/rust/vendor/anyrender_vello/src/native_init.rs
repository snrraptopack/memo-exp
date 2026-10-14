//! Memoized DOM patch: GPU work is Send; completion callbacks stay on the UI.
use std::future::Future;
use std::io;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

type Wake = Arc<dyn Fn() + Send + Sync>;

#[derive(Clone)]
enum Outcome {
    Pending,
    Ready,
    Cancelled,
    Failed(String),
}

/// One current and at most one interrupted initialization run per renderer.
/// Cancellation drops UI callbacks; obsolete results cannot activate a surface.
#[derive(Default)]
pub(crate) struct NativeInitialization {
    outcome: Option<Arc<Mutex<Outcome>>>,
    callback: Option<Box<dyn FnOnce()>>,
    running: Arc<AtomicUsize>,
}

struct WorkerCredit(Arc<AtomicUsize>);

impl Drop for WorkerCredit {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

impl NativeInitialization {
    pub fn begin<F, G>(&mut self, future: F, on_ready: G, wake: Wake)
    where
        F: Future<Output = bool> + Send + 'static,
        G: FnOnce() + 'static,
    {
        self.cancel();
        let outcome = Arc::new(Mutex::new(Outcome::Pending));
        self.outcome = Some(outcome.clone());
        self.callback = Some(Box::new(on_ready));
        if self
            .running
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |count| {
                (count < 2).then_some(count + 1)
            })
            .is_err()
        {
            *outcome.lock().unwrap() =
                Outcome::Failed("GPU initialization budget exhausted".into());
            wake();
            return;
        }
        let running = self.running.clone();
        let failed_outcome = outcome.clone();
        let failed_wake = wake.clone();
        let worker = std::thread::Builder::new()
            .name("memoized-dom-gpu-init".into())
            .spawn(move || {
                let _credit = WorkerCredit(running);
                let result = catch_unwind(AssertUnwindSafe(|| pollster::block_on(future)));
                let result = match result {
                    Ok(true) => Outcome::Ready,
                    Ok(false) => Outcome::Cancelled,
                    Err(payload) => {
                        let message = payload
                            .downcast_ref::<String>()
                            .map(String::as_str)
                            .or_else(|| payload.downcast_ref::<&str>().copied())
                            .unwrap_or("GPU initialization panicked");
                        Outcome::Failed(message.chars().take(512).collect())
                    }
                };
                *outcome.lock().unwrap() = result;
                wake();
            });
        if let Err(error) = worker {
            self.running.fetch_sub(1, Ordering::AcqRel);
            *failed_outcome.lock().unwrap() = Outcome::Failed(error.to_string());
            failed_wake();
        }
    }

    /// Runs on the owning UI loop after a worker wake, never on the worker.
    pub fn notify(&mut self) -> Result<bool, io::Error> {
        let Some(outcome) = &self.outcome else {
            return Ok(false);
        };
        let outcome = outcome.lock().unwrap().clone();
        match outcome {
            Outcome::Pending => Ok(false),
            Outcome::Ready => {
                let callback = self.callback.take();
                self.outcome = None;
                if let Some(callback) = callback {
                    callback();
                    Ok(true)
                } else {
                    Ok(false)
                }
            }
            Outcome::Cancelled => {
                self.cancel();
                Ok(false)
            }
            Outcome::Failed(message) => {
                self.cancel();
                Err(io::Error::other(message))
            }
        }
    }

    pub fn cancel(&mut self) {
        self.outcome = None;
        self.callback = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::rc::Rc;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn pending_gpu_work_does_not_block_ui_or_move_a_non_send_callback() {
        let mut init = NativeInitialization::default();
        let (release, gate) = mpsc::channel();
        let (wake, wakes) = mpsc::channel();
        let called = Rc::new(Cell::new(0));
        let callback = called.clone();
        let ui = std::thread::current().id();
        init.begin(
            async move {
                gate.recv().unwrap();
                true
            },
            move || {
                assert_eq!(std::thread::current().id(), ui);
                callback.set(callback.get() + 1);
            },
            Arc::new(move || {
                let _ = wake.send(());
            }),
        );
        assert!(!init.notify().unwrap());
        assert_eq!(called.get(), 0);
        release.send(()).unwrap();
        wakes.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(init.notify().unwrap());
        assert!(!init.notify().unwrap());
        assert_eq!(called.get(), 1);
    }

    #[test]
    fn interrupted_completion_cannot_call_a_retired_ui_callback() {
        let mut init = NativeInitialization::default();
        let (release, gate) = mpsc::channel();
        let (wake, wakes) = mpsc::channel();
        let called = Rc::new(Cell::new(0));
        let callback = called.clone();
        init.begin(
            async move {
                gate.recv().unwrap();
                true
            },
            move || callback.set(1),
            Arc::new(move || {
                let _ = wake.send(());
            }),
        );
        init.cancel();
        release.send(()).unwrap();
        wakes.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(!init.notify().unwrap());
        assert_eq!(called.get(), 0);
    }

    #[test]
    fn failed_gpu_work_wakes_ui_without_fabricating_renderer_readiness() {
        let mut init = NativeInitialization::default();
        let (wake, wakes) = mpsc::channel();
        init.begin(
            async {
                panic!("controlled GPU failure");
            },
            || panic!("failed renderer called ready"),
            Arc::new(move || {
                let _ = wake.send(());
            }),
        );
        wakes.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(
            init.notify()
                .unwrap_err()
                .to_string()
                .contains("controlled GPU failure")
        );
    }

    #[test]
    fn interrupted_jobs_have_a_finite_budget_and_late_wakes_stay_inert() {
        let mut init = NativeInitialization::default();
        let (wake, wakes) = mpsc::channel();
        let mut releases = Vec::new();
        for _ in 0..2 {
            let (release, gate) = mpsc::channel();
            releases.push(release);
            let wake = wake.clone();
            init.begin(
                async move {
                    gate.recv().unwrap();
                    true
                },
                || panic!("interrupted callback was invoked"),
                Arc::new(move || {
                    let _ = wake.send(());
                }),
            );
            init.cancel();
        }
        init.begin(
            async { true },
            || panic!("over-budget callback was invoked"),
            Arc::new(move || {
                let _ = wake.send(());
            }),
        );
        wakes.recv_timeout(Duration::from_secs(2)).unwrap();
        assert!(
            init.notify()
                .unwrap_err()
                .to_string()
                .contains("budget exhausted")
        );
        for release in releases {
            release.send(()).unwrap();
            wakes.recv_timeout(Duration::from_secs(2)).unwrap();
            assert!(!init.notify().unwrap());
        }
    }
}
