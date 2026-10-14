//! Bounded worker transport. The document stays on its owning thread.
//!
//! The wake callback schedules that thread (for example an event-loop proxy).
//! It must be nonblocking and must not apply publications itself. No polling
//! timer or pipe wait is required on the document/UI thread.

use std::io::{self, Read, Write};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::mpsc::{self, Receiver, SyncSender, TryRecvError, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};

use super::{FrameReader, FrameWriter, PublicationReply, PublicationSession};
#[cfg(feature = "window")]
use crate::events::wire::{DispatchDecision, EventPacket};
use serde::Serialize;

/// At most eight inbound frames and eight pending replies (including the
/// writer's in-flight reply). The reader may hold one additional bounded frame.
pub const QUEUE_CAPACITY: usize = 8;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ConnectionFailure {
    pub code: &'static str,
    pub message: String,
}

impl ConnectionFailure {
    pub(crate) fn new(code: &'static str, message: impl ToString) -> Self {
        Self {
            code,
            message: message.to_string().chars().take(512).collect(),
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DriverStatus {
    Running,
    Finished,
    Failed(ConnectionFailure),
}

enum Incoming {
    Packet(Vec<u8>),
    #[cfg(feature = "window")]
    Decision(DispatchDecision),
    End,
}

#[derive(Serialize)]
#[serde(untagged)]
enum OutputMessage {
    Publication(PublicationReply),
    #[cfg(feature = "window")]
    Event(EventPacket),
    #[cfg(feature = "window")]
    Ready {
        kind: &'static str,
        version: u32,
    },
}

#[cfg(feature = "window")]
pub(crate) struct EventSink {
    sender: SyncSender<OutputMessage>,
    state: Arc<WorkerState>,
}

#[cfg(feature = "window")]
impl EventSink {
    pub fn ready(&self) -> Result<(), ConnectionFailure> {
        self.enqueue(OutputMessage::Ready {
            kind: "ready",
            version: 1,
        })
    }

    pub fn send(&self, packet: EventPacket) -> Result<(), ConnectionFailure> {
        self.enqueue(OutputMessage::Event(packet))
    }

    fn enqueue(&self, packet: OutputMessage) -> Result<(), ConnectionFailure> {
        // This sink is used only by the document thread. Reserve shared output
        // capacity before enqueueing; the stream writer releases it on flush.
        if self.state.pending_replies.load(Ordering::Acquire) >= QUEUE_CAPACITY {
            let failure =
                ConnectionFailure::new("eventQueueFull", "Native interaction output is full");
            self.state.fail(failure.clone());
            return Err(failure);
        }
        self.state.pending_replies.fetch_add(1, Ordering::AcqRel);
        if self.sender.try_send(packet).is_err() {
            let failure =
                ConnectionFailure::new("eventWorkerLost", "Native interaction delivery failed");
            self.state.fail(failure.clone());
            return Err(failure);
        }
        Ok(())
    }
}

struct WorkerState {
    stopping: AtomicBool,
    pending_replies: AtomicUsize,
    failure: Mutex<Option<ConnectionFailure>>,
    wake: Arc<dyn Fn() + Send + Sync>,
}

impl WorkerState {
    fn failure(&self) -> Option<ConnectionFailure> {
        self.failure.lock().unwrap().clone()
    }

    fn fail(&self, failure: ConnectionFailure) {
        let mut current = self.failure.lock().unwrap();
        if current.is_none() {
            *current = Some(failure);
        }
        drop(current);
        self.stopping.store(true, Ordering::Release);
        (self.wake)();
    }
}

/// A replaceable process stream, independent of compiler/runtime semantics.
/// `poll` performs bounded document work and only nonblocking queue operations.
pub struct ProcessDriver {
    session: PublicationSession,
    incoming: Option<Receiver<Incoming>>,
    outgoing: Option<SyncSender<OutputMessage>>,
    writer: Option<JoinHandle<()>>,
    state: Arc<WorkerState>,
    status: DriverStatus,
}

impl ProcessDriver {
    pub fn start<R, W>(
        session: PublicationSession,
        input: R,
        output: W,
        wake: Arc<dyn Fn() + Send + Sync>,
    ) -> io::Result<Self>
    where
        R: Read + Send + 'static,
        W: Write + Send + 'static,
    {
        let (input_sender, incoming) = mpsc::sync_channel(QUEUE_CAPACITY);
        let (outgoing, output_receiver) = mpsc::sync_channel(QUEUE_CAPACITY);
        let state = Arc::new(WorkerState {
            stopping: AtomicBool::new(false),
            pending_replies: AtomicUsize::new(0),
            failure: Mutex::new(None),
            wake,
        });

        let writer_state = state.clone();
        let writer = thread::Builder::new()
            .name("desktop-stream-writer".into())
            .spawn(move || {
                let result = catch_unwind(AssertUnwindSafe(|| {
                    write_replies(output, output_receiver, writer_state.clone());
                }));
                if result.is_err() {
                    writer_state.fail(ConnectionFailure::new(
                        "writerWorkerLost",
                        "reply writer panicked",
                    ));
                }
            })?;

        let reader_state = state.clone();
        if let Err(error) = thread::Builder::new()
            .name("desktop-stream-reader".into())
            .spawn(move || {
                let result = catch_unwind(AssertUnwindSafe(|| {
                    read_packets(input, input_sender, reader_state.clone());
                }));
                if result.is_err() {
                    reader_state.fail(ConnectionFailure::new(
                        "readerWorkerLost",
                        "frame reader panicked",
                    ));
                }
            })
        {
            // Dropping outgoing releases the waiting writer. No native work
            // was admitted, and no blocking worker join belongs here.
            state.stopping.store(true, Ordering::Release);
            return Err(error);
        }

        Ok(Self {
            session,
            incoming: Some(incoming),
            outgoing: Some(outgoing),
            writer: Some(writer),
            state,
            status: DriverStatus::Running,
        })
    }

    pub fn session(&self) -> &PublicationSession {
        &self.session
    }

    #[cfg(feature = "window")]
    pub(crate) fn session_mut(&mut self) -> &mut PublicationSession {
        &mut self.session
    }

    /// Call on a worker wake. A finite budget lets input/layout/paint run between
    /// bursts. Remaining work schedules another wake rather than a polling loop.
    pub fn poll(&mut self) -> DriverStatus {
        #[cfg(feature = "window")]
        return self.poll_with_controls(|_, _, _| {
            Err(ConnectionFailure::new(
                "unexpectedDecision",
                "Headless publication mode cannot receive interaction decisions",
            ))
        });
        #[cfg(not(feature = "window"))]
        return self.poll_core();
    }

    #[cfg(feature = "window")]
    pub(crate) fn event_sink(&self) -> EventSink {
        EventSink {
            sender: self.outgoing.as_ref().unwrap().clone(),
            state: self.state.clone(),
        }
    }

    #[cfg(feature = "window")]
    pub(crate) fn poll_with_controls(
        &mut self,
        mut control: impl FnMut(
            &mut crate::document::NativeDocument,
            DispatchDecision,
            u64,
        ) -> Result<(), ConnectionFailure>,
    ) -> DriverStatus {
        self.poll_core(&mut control)
    }

    fn poll_core(
        &mut self,
        #[cfg(feature = "window")] control: &mut impl FnMut(
            &mut crate::document::NativeDocument,
            DispatchDecision,
            u64,
        ) -> Result<(), ConnectionFailure>,
    ) -> DriverStatus {
        if let Some(failure) = self.state.failure() {
            self.stop(DriverStatus::Failed(failure));
        }
        if self.status != DriverStatus::Running {
            return self.status.clone();
        }

        for _ in 0..QUEUE_CAPACITY {
            // A failed reply worker means the sender cannot know acceptance.
            // Check before each publication, not merely once per burst.
            if let Some(failure) = self.state.failure() {
                self.stop(DriverStatus::Failed(failure));
                break;
            }
            // Only this document thread acquires reply slots; the writer
            // releases them after flushing. Reserve capacity before applying
            // native work, so an ordinary burst cannot lose its acknowledgment.
            if self.state.pending_replies.load(Ordering::Acquire) == QUEUE_CAPACITY {
                return DriverStatus::Running;
            }
            match self.incoming.as_ref().unwrap().try_recv() {
                Ok(Incoming::Packet(bytes)) => {
                    self.state.pending_replies.fetch_add(1, Ordering::AcqRel);
                    let expected = self.session.expected_sequence();
                    let reply = match self.session.publish(&bytes) {
                        Ok(accepted) => PublicationReply::Accepted(accepted),
                        Err(error) => PublicationReply::rejected(&error, expected),
                    };
                    let fatal = reply.is_fatal();
                    if let Err(error) = self
                        .outgoing
                        .as_ref()
                        .unwrap()
                        .try_send(OutputMessage::Publication(reply))
                    {
                        let code = match error {
                            TrySendError::Full(_) => "replyQueueFull",
                            TrySendError::Disconnected(_) => "replyWorkerLost",
                        };
                        // A full channel here violates the reserved-slot
                        // invariant. A disconnected worker loses acceptance.
                        // Either is terminal, with no blocking or scene replay.
                        let failure = ConnectionFailure::new(
                            code,
                            "reply delivery unavailable; acceptance is unknown",
                        );
                        self.state.fail(failure.clone());
                        self.stop(DriverStatus::Failed(failure));
                        break;
                    }
                    if fatal {
                        // Drain the already queued fatal reply on the writer.
                        // No subsequent publication is admitted on this session.
                        self.stop(DriverStatus::Failed(ConnectionFailure::new(
                            "publicationFatal",
                            "publication terminated the connection",
                        )));
                        break;
                    }
                }
                #[cfg(feature = "window")]
                Ok(Incoming::Decision(decision)) => {
                    let sequence = self
                        .session
                        .expected_sequence()
                        .unwrap_or(9_007_199_254_740_992)
                        - 1;
                    if let Err(failure) = control(self.session.document_mut(), decision, sequence) {
                        self.state.fail(failure.clone());
                        self.stop(DriverStatus::Failed(failure));
                        break;
                    }
                }
                Ok(Incoming::End) => {
                    // EOF is ordered behind complete frames, so accepted replies
                    // can drain even when the parent closes stdin immediately.
                    self.stop(DriverStatus::Finished);
                    break;
                }
                Err(TryRecvError::Empty) => return DriverStatus::Running,
                Err(TryRecvError::Disconnected) => {
                    self.stop(DriverStatus::Failed(ConnectionFailure::new(
                        "readerWorkerLost",
                        "reader ended without a frame-boundary EOF",
                    )));
                    break;
                }
            }
        }
        if self.status == DriverStatus::Running {
            (self.state.wake)();
        }
        self.status.clone()
    }

    /// Explicit cancellation immediately stops document admission and provider
    /// work. It does not join a reader blocked inside an OS pipe read.
    pub fn close(&mut self) {
        if self.status == DriverStatus::Running {
            self.stop(DriverStatus::Finished);
        }
    }

    /// Only for a terminating headless process/tests, never a UI callback.
    /// The owner must close/terminate OS streams if its peer is unresponsive:
    /// generic Read/Write cannot promise cancellation of a blocked syscall.
    pub fn finish_headless(&mut self) -> DriverStatus {
        assert_ne!(self.status, DriverStatus::Running);
        if let Some(writer) = self.writer.take()
            && writer.join().is_err()
        {
            self.state.fail(ConnectionFailure::new(
                "writerWorkerLost",
                "reply writer panicked",
            ));
        }
        if let Some(failure) = self.state.failure() {
            self.status = DriverStatus::Failed(failure);
        }
        self.status.clone()
    }

    fn stop(&mut self, status: DriverStatus) {
        self.session.close();
        self.state.stopping.store(true, Ordering::Release);
        self.incoming.take();
        self.outgoing.take();
        self.status = status;
    }
}

impl Drop for ProcessDriver {
    fn drop(&mut self) {
        self.close();
        // Handles detach. The process/stream owner handles OS interruption;
        // dropping a UI driver must never wait for the peer to read or write.
    }
}

fn read_packets<R: Read>(input: R, incoming: SyncSender<Incoming>, state: Arc<WorkerState>) {
    let mut reader = FrameReader::new(input);
    while !state.stopping.load(Ordering::Acquire) {
        let message = match reader.read_packet() {
            Ok(Some(bytes)) => {
                #[cfg(feature = "window")]
                {
                    // Strict decision decoding rejects publication's sequence
                    // field immediately. Ordinary scenes retain their existing
                    // complete document-thread decoder and refusal semantics.
                    match serde_json::from_slice::<DispatchDecision>(&bytes) {
                        Ok(decision) => Incoming::Decision(decision),
                        Err(_) => Incoming::Packet(bytes),
                    }
                }
                #[cfg(not(feature = "window"))]
                Incoming::Packet(bytes)
            }
            Ok(None) => Incoming::End,
            Err(error) => {
                state.fail(ConnectionFailure::new("readFailed", error));
                return;
            }
        };
        let end = matches!(message, Incoming::End);
        // Backpressure blocks only this reader. Dropping the receiver releases
        // a reader waiting for capacity; no growing unbounded frame queue.
        if state.stopping.load(Ordering::Acquire) || incoming.send(message).is_err() {
            return;
        }
        (state.wake)();
        if end {
            return;
        }
    }
}

fn write_replies<W: Write>(output: W, replies: Receiver<OutputMessage>, state: Arc<WorkerState>) {
    let mut writer = FrameWriter::new(output);
    for reply in replies {
        if state.failure().is_some() {
            return;
        }
        if let Err(error) = writer.write_json(&reply) {
            state.fail(ConnectionFailure::new("writeFailed", error));
            return;
        }
        state.pending_replies.fetch_sub(1, Ordering::AcqRel);
        // Admission may be paused waiting for a slot. Wake it on actual stream
        // progress, without a busy loop or UI timer while the peer is stalled.
        (state.wake)();
    }
}
