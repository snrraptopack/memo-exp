//! Held clicks resume once, after the synchronous JavaScript decision.
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

use super::wire::{DecisionKind, DispatchDecision, EventPacket};
use crate::document::{NativeDocument, NodeRef};
use crate::protocol::{ConnectionFailure, EventSink};
use blitz_traits::events::DomEvent;

const MAX_PENDING: usize = 8;
const MAX_SAFE_ID: u64 = 9_007_199_254_740_991;
const DECISION_TIMEOUT: Duration = Duration::from_secs(5);

struct PendingClick {
    target: NodeRef,
    event: DomEvent,
    deadline: Instant,
}

pub(crate) struct PendingDefaults {
    pending: BTreeMap<u64, PendingClick>,
    next_id: u64,
    started: Instant,
    failure: Option<ConnectionFailure>,
    pub scene_sequence: u64,
}

impl PendingDefaults {
    pub fn new() -> Self {
        Self {
            pending: BTreeMap::new(),
            next_id: 1,
            started: Instant::now(),
            failure: None,
            scene_sequence: 0,
        }
    }

    pub fn record(&mut self, path: Vec<NodeRef>, event: DomEvent, sink: &EventSink) {
        if self.failure.is_some() {
            return;
        }
        if self.pending.len() == MAX_PENDING || self.next_id > MAX_SAFE_ID {
            self.failure = Some(ConnectionFailure::new(
                "dispatchQueueFull",
                "Native default queue exhausted",
            ));
            return;
        }
        let id = self.next_id;
        self.next_id += 1;
        let packet = EventPacket {
            kind: "event",
            version: 1,
            dispatch_id: id,
            event_type: "click",
            cancelable: event.cancelable,
            bubbles: event.bubbles,
            timestamp: self.started.elapsed().as_secs_f64() * 1000.0,
            path: path.clone(),
            scene_sequence: self.scene_sequence,
        };
        self.pending.insert(
            id,
            PendingClick {
                target: path[0].clone(),
                event,
                deadline: Instant::now() + DECISION_TIMEOUT,
            },
        );
        if let Err(failure) = sink.send(packet) {
            self.failure = Some(failure);
        }
    }

    pub fn decide(
        &mut self,
        doc: &mut NativeDocument,
        decision: DispatchDecision,
        sink: &EventSink,
    ) -> Result<(), ConnectionFailure> {
        let DispatchDecision {
            kind: DecisionKind::DispatchResult,
            version,
            dispatch_id,
            cancelled,
        } = decision;
        if version != 1 || dispatch_id == 0 || dispatch_id > MAX_SAFE_ID {
            return Err(ConnectionFailure::new(
                "invalidDecision",
                "Invalid interaction decision identity",
            ));
        }
        let pending = self.pending.remove(&dispatch_id).ok_or_else(|| {
            ConnectionFailure::new(
                "unknownDecision",
                "Interaction decision is unknown or duplicated",
            )
        })?;
        if Instant::now() >= pending.deadline {
            return Err(ConnectionFailure::new(
                "dispatchTimedOut",
                "JavaScript dispatch decision timed out",
            ));
        }
        if !cancelled || !pending.event.cancelable {
            doc.resume_click(&pending.target, pending.event, |path, event| {
                self.record(path, event, sink)
            });
        }
        self.check_failure()
    }

    pub fn next_deadline(&self) -> Option<Instant> {
        self.pending.values().map(|item| item.deadline).min()
    }

    pub fn check_failure(&mut self) -> Result<(), ConnectionFailure> {
        if self
            .next_deadline()
            .is_some_and(|deadline| Instant::now() >= deadline)
        {
            self.failure = Some(ConnectionFailure::new(
                "dispatchTimedOut",
                "JavaScript dispatch decision timed out",
            ));
        }
        match &self.failure {
            Some(failure) => Err(failure.clone()),
            None => Ok(()),
        }
    }
}
