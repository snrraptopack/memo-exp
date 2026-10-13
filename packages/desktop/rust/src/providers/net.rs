use std::sync::Arc;

use blitz_traits::net::{NetHandler, NetProvider, Request};

use super::{Fetch, MAX_QUEUED_RESOURCES, Phase, PublicationProviders};

pub(super) struct ControlledNet(pub Arc<PublicationProviders>);

impl NetProvider for ControlledNet {
    fn fetch(&self, document: usize, request: Request, handler: Box<dyn NetHandler>) {
        let mut phase = self.0.phase.lock().unwrap();
        match &mut *phase {
            Phase::Idle => {
                drop(phase);
                self.0.net.fetch(document, request, handler);
            }
            Phase::Held(pending) => {
                assert!(
                    pending.queued_resources < MAX_QUEUED_RESOURCES,
                    "desktop resource publication capacity exceeded"
                );
                pending.queued_resources += 1;
                pending.resources.push(Fetch {
                    document,
                    request,
                    handler,
                });
            }
            Phase::Failed => {}
        }
    }

    fn is_noop(&self) -> bool {
        // Preserve Blitz's critical-resource accounting for a real/no-op backend.
        self.0.net.is_noop()
    }
}
