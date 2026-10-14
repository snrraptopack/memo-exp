//! Opt-in startup timings. These never participate in publication acceptance.
use std::time::Instant;

#[derive(Clone, Copy)]
pub(super) struct StartupTrace {
    started: Instant,
    enabled: bool,
}

impl StartupTrace {
    pub fn new() -> Self {
        Self {
            started: Instant::now(),
            enabled: std::env::var("MEMOIZED_DESKTOP_TRACE").is_ok_and(|value| value == "1"),
        }
    }

    pub fn mark(self, stage: &'static str) {
        if self.enabled {
            eprintln!(
                "desktop-startup {}",
                serde_json::json!({
                    "stage": stage,
                    "elapsedMs": self.started.elapsed().as_secs_f64() * 1000.0,
                })
            );
        }
    }
}
