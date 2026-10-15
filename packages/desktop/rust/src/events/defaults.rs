//! Serialize script-visible defaults and the input notifications they generate.
use std::collections::VecDeque;
use std::time::{Duration, Instant};

use super::wire::{ControlledValue, DecisionKind, DispatchDecision, EventPacket, KeyboardState};
use crate::document::{ControlState, Mutation, NativeDocument, NodeRef};
use crate::protocol::{ConnectionFailure, EventSink};
use blitz_traits::events::{DomEvent, DomEventData, UiEvent};

const MAX_PENDING: usize = 8;
const MAX_SAFE_ID: u64 = 9_007_199_254_740_991;
const DECISION_TIMEOUT: Duration = Duration::from_secs(5);

struct HeldEvent {
    path: Vec<NodeRef>,
    event: DomEvent,
    control: Option<ControlState>,
}

enum QueuedInteraction {
    Native {
        event: UiEvent,
        focus: Option<NodeRef>,
    },
    Script(HeldEvent),
}

struct PendingEvent {
    id: u64,
    held: HeldEvent,
    deadline: Instant,
}

pub(crate) struct PendingDefaults {
    pending: Option<PendingEvent>,
    queued: VecDeque<QueuedInteraction>,
    resuming: bool,
    next_id: u64,
    started: Instant,
    failure: Option<ConnectionFailure>,
    pub scene_sequence: u64,
}

impl PendingDefaults {
    pub fn new() -> Self {
        Self {
            pending: None,
            queued: VecDeque::new(),
            resuming: false,
            next_id: 1,
            started: Instant::now(),
            failure: None,
            scene_sequence: 0,
        }
    }

    pub fn handle_ui_event(&mut self, doc: &mut NativeDocument, event: UiEvent, sink: &EventSink) {
        // Order keys with focus-changing pointer actions, so clicking Add cannot
        // steal focus before the last character is applied. Wheel and passive
        // hover continue immediately; the UI thread never waits on this queue.
        let ordered = match &event {
            UiEvent::Wheel(_) => false,
            UiEvent::PointerMove(pointer) => !pointer.buttons.is_empty(),
            _ => true,
        };
        if self.pending.is_some() && ordered {
            let focus = match event {
                UiEvent::KeyDown(_)
                | UiEvent::KeyUp(_)
                | UiEvent::Ime(_)
                | UiEvent::AppleStandardKeybinding(_) => doc.focused_source(),
                _ => None,
            };
            self.enqueue(QueuedInteraction::Native { event, focus }, false);
        } else {
            doc.capture_events(event, |path, event, control| {
                self.record(path, event, control, sink)
            });
        }
    }

    fn enqueue(&mut self, interaction: QueuedInteraction, first: bool) {
        if self.queued.len() + usize::from(self.pending.is_some()) >= MAX_PENDING {
            self.failure = Some(ConnectionFailure::new(
                "dispatchQueueFull",
                "Native default queue exhausted",
            ));
        } else if first {
            self.queued.push_front(interaction);
        } else {
            self.queued.push_back(interaction);
        }
    }

    fn record(
        &mut self,
        path: Vec<NodeRef>,
        event: DomEvent,
        control: Option<ControlState>,
        sink: &EventSink,
    ) {
        if self.failure.is_some() {
            return;
        }
        let held = HeldEvent {
            path,
            event,
            control,
        };
        if self.pending.is_some() || self.resuming {
            // Generated input belongs before later captured interactions.
            self.enqueue(QueuedInteraction::Script(held), self.resuming);
        } else {
            self.send(held, sink);
        }
    }

    fn send(&mut self, held: HeldEvent, sink: &EventSink) {
        if self.next_id > MAX_SAFE_ID {
            self.failure = Some(ConnectionFailure::new(
                "dispatchQueueFull",
                "Native dispatch identity exhausted",
            ));
            return;
        }
        let id = self.next_id;
        self.next_id += 1;
        let packet = EventPacket {
            kind: "event",
            version: 1,
            dispatch_id: id,
            event_type: held.event.name(),
            cancelable: held.event.cancelable,
            bubbles: held.event.bubbles,
            timestamp: self.started.elapsed().as_secs_f64() * 1000.0,
            path: held.path.clone(),
            scene_sequence: self.scene_sequence,
            control: held.control.clone(),
            keyboard: KeyboardState::from_data(&held.event.data),
        };
        self.pending = Some(PendingEvent {
            id,
            held,
            deadline: Instant::now() + DECISION_TIMEOUT,
        });
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
            controls,
        } = decision;
        if version != 1 || dispatch_id == 0 || dispatch_id > MAX_SAFE_ID {
            return Err(ConnectionFailure::new(
                "invalidDecision",
                "Invalid interaction decision identity",
            ));
        }
        if !self
            .pending
            .as_ref()
            .is_some_and(|pending| pending.id == dispatch_id)
        {
            return Err(ConnectionFailure::new(
                "unknownDecision",
                "Interaction decision is unknown or duplicated",
            ));
        }
        self.check_failure()?;
        if controls.len() > crate::protocol::MAX_OPERATIONS {
            return Err(ConnectionFailure::new(
                "invalidDecision",
                "Too many controlled values",
            ));
        }
        let writes = controls
            .into_iter()
            .map(|control| {
                let ControlledValue::Value {
                    target,
                    value,
                    revision,
                    version,
                } = control;
                let target = target
                    .into_reference()
                    .map_err(|error| ConnectionFailure::new("invalidDecision", error))?;
                Ok(Mutation::Value {
                    target,
                    value,
                    revision,
                    version,
                })
            })
            .collect::<Result<Vec<_>, ConnectionFailure>>()?;
        let writes: Vec<_> = writes
            .into_iter()
            .filter(|write| match write {
                Mutation::Value { target, .. } => doc.node_id(target).is_ok(),
                _ => unreachable!("decision codec only creates value writes"),
            })
            .collect();
        doc.update(&writes)
            .map_err(|error| ConnectionFailure::new("invalidDecision", error))?;
        if !writes.is_empty() {
            doc.engine().shell_provider.request_redraw();
        }
        let pending = self.pending.take().unwrap();
        if (!cancelled || !pending.held.event.cancelable)
            && !matches!(pending.held.event.data, DomEventData::Input(_))
        {
            self.resuming = true;
            doc.resume_event(
                &pending.held.path[0],
                pending.held.event,
                |path, event, control| self.record(path, event, control, sink),
            );
            self.resuming = false;
        }

        while self.pending.is_none() && self.failure.is_none() {
            let Some(next) = self.queued.pop_front() else {
                break;
            };
            match next {
                QueuedInteraction::Native { event, focus } => {
                    if focus
                        .as_ref()
                        .is_some_and(|source| doc.node_id(source).is_err())
                    {
                        continue;
                    }
                    doc.capture_events(event, |path, event, control| {
                        self.record(path, event, control, sink)
                    });
                }
                QueuedInteraction::Script(mut held) => {
                    // Refresh a queued click's value after earlier edits.
                    if doc.node_id(&held.path[0]).ok() != Some(held.event.target) {
                        continue;
                    }
                    held.control = doc.control_state(held.event.target).or(held.control);
                    self.send(held, sink);
                }
            }
        }
        self.check_failure()
    }

    pub fn next_deadline(&self) -> Option<Instant> {
        self.pending.as_ref().map(|pending| pending.deadline)
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
