use std::io::{self, Cursor, Read, Write};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::{Duration, Instant};

use blitz_dom::{DocumentConfig, StyleThreading};
use blitz_traits::shell::ShellProvider;
use memoized_dom_desktop::protocol::{
    DriverStatus, FrameReader, FrameWriter, ProcessDriver, PublicationSession, QUEUE_CAPACITY,
};
use serde_json::{Value, json};

use super::{NativeDocument, Owner, body_text, host};

const DEADLINE: Duration = Duration::from_secs(10);

/// Controlled blocking input. Closing the sender supplies a real stream EOF.
struct Input {
    chunks: mpsc::Receiver<Vec<u8>>,
    current: Cursor<Vec<u8>>,
}

impl Read for Input {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        let count = self.current.read(bytes)?;
        if count != 0 || bytes.is_empty() {
            return Ok(count);
        }
        match self.chunks.recv() {
            Ok(chunk) => {
                self.current = Cursor::new(chunk);
                self.current.read(bytes)
            }
            Err(_) => Ok(0),
        }
    }
}

#[derive(Clone, Default)]
struct Output(Arc<Mutex<Vec<u8>>>);

impl Write for Output {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

fn framed(value: &Value) -> Vec<u8> {
    let mut bytes = Vec::new();
    FrameWriter::new(&mut bytes).write_json(value).unwrap();
    bytes
}

fn empty(sequence: u64) -> Value {
    json!({"version": 1, "sequence": sequence, "operations": []})
}

fn mount() -> Value {
    json!({
        "version": 1,
        "sequence": 1,
        "templates": [{
            "key": "label",
            "nodes": [{"parent": null, "node": {"kind": "text", "value": "before"}}]
        }],
        "operations": [{
            "op": "mount",
            "owner": {"id": "App", "generation": 1},
            "template": "label",
            "target": {"kind": "body"}
        }]
    })
}

fn start<W: Write + Send + 'static>(
    output: W,
) -> (ProcessDriver, mpsc::Sender<Vec<u8>>, mpsc::Receiver<()>) {
    let (document, _) = host();
    start_session(PublicationSession::new(document), output)
}

fn start_session<W: Write + Send + 'static>(
    session: PublicationSession,
    output: W,
) -> (ProcessDriver, mpsc::Sender<Vec<u8>>, mpsc::Receiver<()>) {
    let (sender, chunks) = mpsc::channel();
    let (wake_sender, wakes) = mpsc::sync_channel(1);
    let wake = Arc::new(move || {
        let _ = wake_sender.try_send(());
    });
    let driver = ProcessDriver::start(
        session,
        Input {
            chunks,
            current: Cursor::new(Vec::new()),
        },
        output,
        wake,
    )
    .unwrap();
    (driver, sender, wakes)
}

fn finish(driver: &mut ProcessDriver, wakes: &mpsc::Receiver<()>) -> DriverStatus {
    let deadline = Instant::now() + DEADLINE;
    while driver.poll() == DriverStatus::Running {
        wakes
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .expect("transport failed to wake the document thread");
    }
    driver.finish_headless()
}

fn replies(output: &Output) -> Vec<Value> {
    let mut reader = FrameReader::new(Cursor::new(output.0.lock().unwrap().clone()));
    let mut values = Vec::new();
    while let Some(bytes) = reader.read_packet().unwrap() {
        values.push(serde_json::from_slice(&bytes).unwrap());
    }
    values
}

#[test]
fn refusal_reply_keeps_the_slot_and_corrected_mount_applies_before_eof() {
    let output = Output::default();
    let (mut driver, input, wakes) = start(output.clone());
    input.send(framed(&json!({"invalid": true}))).unwrap();
    input.send(framed(&mount())).unwrap();
    input.send(framed(&empty(3))).unwrap();
    input
        .send(framed(&json!({
            "version": 1,
            "sequence": 2,
            "operations": [{
                "op": "text",
                "target": {"owner": {"id": "App", "generation": 1}, "source": 0},
                "value": "after"
            }]
        })))
        .unwrap();
    drop(input);

    assert_eq!(finish(&mut driver, &wakes), DriverStatus::Finished);
    assert_eq!(body_text(driver.session().document()), "after");
    let values = replies(&output);
    assert_eq!(values.len(), 4);
    assert_eq!(values[0]["version"], 1);
    assert_eq!(values[0]["status"], "refused");
    assert_eq!(values[0]["code"], "decode");
    assert_eq!(values[0]["expectedSequence"], 1);
    assert_eq!(
        values[1],
        json!({"version": 1, "sequence": 1, "status": "accepted"})
    );
    assert_eq!(values[2]["code"], "outOfOrder");
    assert_eq!(values[2]["expectedSequence"], 2);
    assert_eq!(values[3]["sequence"], 2);
    assert!(driver.session().is_closed());
}

struct BrokenOutput;

impl Write for BrokenOutput {
    fn write(&mut self, _: &[u8]) -> io::Result<usize> {
        Err(io::Error::new(
            io::ErrorKind::BrokenPipe,
            "peer stopped reading",
        ))
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[test]
fn lost_acceptance_wakes_and_closes_the_applied_document_without_replay() {
    let (mut driver, input, wakes) = start(BrokenOutput);
    input.send(framed(&mount())).unwrap();
    let status = finish(&mut driver, &wakes);
    let DriverStatus::Failed(failure) = status else {
        panic!("lost acknowledgment was reported as success")
    };
    assert_eq!(failure.code, "writeFailed");
    assert_eq!(driver.session().document().owner_count(), 1);
    assert_eq!(body_text(driver.session().document()), "before");
    assert!(driver.session().is_closed());
    assert_eq!(driver.poll(), DriverStatus::Failed(failure));
    drop(input);
}

#[test]
fn bad_framing_wakes_and_closes_without_guessing_a_new_boundary() {
    let output = Output::default();
    let (mut driver, input, wakes) = start(output.clone());
    input.send(vec![0, 0, 0, 0]).unwrap();
    input.send(framed(&mount())).unwrap();
    drop(input);
    let DriverStatus::Failed(failure) = finish(&mut driver, &wakes) else {
        panic!("invalid frame was not terminal")
    };
    assert_eq!(failure.code, "readFailed");
    assert_eq!(driver.session().document().owner_count(), 0);
    assert!(replies(&output).is_empty());
}

/// A stalled OS write must not stall publication polling or grow reply memory.
struct StalledOutput {
    entered: mpsc::Sender<()>,
    release: Option<mpsc::Receiver<()>>,
    output: Output,
}

impl Write for StalledOutput {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if let Some(release) = self.release.take() {
            self.entered.send(()).unwrap();
            release.recv_timeout(DEADLINE).unwrap();
        }
        self.output.write(bytes)
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

#[test]
fn reply_pressure_pauses_admission_and_resumes_on_writer_progress_without_replay() {
    let (entered_sender, entered) = mpsc::channel();
    let (release, release_receiver) = mpsc::channel();
    let output = Output::default();
    let (mut driver, input, wakes) = start(StalledOutput {
        entered: entered_sender,
        release: Some(release_receiver),
        output: output.clone(),
    });
    input.send(framed(&empty(1))).unwrap();
    wakes.recv_timeout(DEADLINE).unwrap();
    assert_eq!(driver.poll(), DriverStatus::Running);
    entered.recv_timeout(DEADLINE).unwrap();

    for sequence in 2..=(QUEUE_CAPACITY as u64 + 3) {
        input.send(framed(&empty(sequence))).unwrap();
    }
    let deadline = Instant::now() + DEADLINE;
    while driver.session().expected_sequence() != Some(QUEUE_CAPACITY as u64 + 1) {
        assert_eq!(driver.poll(), DriverStatus::Running);
        if driver.session().expected_sequence() == Some(QUEUE_CAPACITY as u64 + 1) {
            break;
        }
        wakes
            .recv_timeout(deadline.saturating_duration_since(Instant::now()))
            .unwrap();
    }
    // The writer still cannot return. Repeated UI polls must remain available,
    // and cannot apply the ninth publication without a reserved reply slot.
    for _ in 0..3 {
        assert_eq!(driver.poll(), DriverStatus::Running);
        assert_eq!(
            driver.session().expected_sequence(),
            Some(QUEUE_CAPACITY as u64 + 1)
        );
    }
    assert!(!driver.session().is_closed());
    release.send(()).unwrap();
    drop(input);
    assert_eq!(finish(&mut driver, &wakes), DriverStatus::Finished);
    let values = replies(&output);
    assert_eq!(values.len(), QUEUE_CAPACITY + 3);
    for (index, value) in values.iter().enumerate() {
        assert_eq!(value["sequence"], index + 1);
        assert_eq!(value["status"], "accepted");
    }
}

#[test]
fn close_does_not_wait_for_a_reader_blocked_inside_read() {
    let (mut driver, input, _) = start(Output::default());
    assert_eq!(driver.poll(), DriverStatus::Running);
    driver.close();
    assert!(driver.session().is_closed());
    assert_eq!(driver.poll(), DriverStatus::Finished);
    // Close the owned stream so the detached reader can actually terminate.
    drop(input);
    assert_eq!(driver.finish_headless(), DriverStatus::Finished);
}

/// Always kill on test failure; a protocol timeout must not leave a host behind.
struct HostProcess(Child);

impl Drop for HostProcess {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn real_host_process_refuses_retries_and_drains_accepted_replies_on_stdin_close() {
    let mut process = HostProcess(
        Command::new(env!("CARGO_BIN_EXE_memoized-dom-desktop"))
            .arg("--headless")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap(),
    );
    let stdout = process.0.stdout.take().unwrap();
    let (received, responses) = mpsc::channel();
    let reader = thread::spawn(move || {
        let mut reader = FrameReader::new(stdout);
        while let Some(packet) = reader.read_packet().unwrap() {
            received
                .send(serde_json::from_slice::<Value>(&packet).unwrap())
                .unwrap();
        }
    });
    let mut stdin = FrameWriter::new(process.0.stdin.take().unwrap());
    stdin
        .write_json(&json!({"version": 900, "sequence": 1, "operations": []}))
        .unwrap();
    let refused = responses.recv_timeout(DEADLINE).unwrap();
    assert_eq!(refused["status"], "refused");
    assert_eq!(refused["code"], "unsupportedVersion");
    assert_eq!(refused["expectedSequence"], 1);

    stdin.write_json(&mount()).unwrap();
    assert_eq!(responses.recv_timeout(DEADLINE).unwrap()["sequence"], 1);
    // The same immutable template can be reused across process publications.
    stdin
        .write_json(&json!({
            "version": 1,
            "sequence": 2,
            "operations": [{
                "op": "mount",
                "owner": {"id": "second", "generation": 1},
                "template": "label",
                "target": {"kind": "body"}
            }]
        }))
        .unwrap();
    drop(stdin);
    assert_eq!(responses.recv_timeout(DEADLINE).unwrap()["sequence"], 2);
    assert!(responses.recv_timeout(DEADLINE).is_err());
    let status = process.0.wait().unwrap();
    assert!(status.success(), "native host exit: {status}");
    reader.join().unwrap();
}

#[test]
fn unknown_template_refusal_does_not_create_native_sources() {
    let output = Output::default();
    let (mut driver, input, wakes) = start(output.clone());
    let mut packet = mount();
    packet.as_object_mut().unwrap().remove("templates");
    input.send(framed(&packet)).unwrap();
    drop(input);
    assert_eq!(finish(&mut driver, &wakes), DriverStatus::Finished);
    assert_eq!(driver.session().document().owner_count(), 0);
    assert!(
        driver
            .session()
            .document()
            .node_id(&Owner::new("App", 1).node(0))
            .is_err()
    );
    let values = replies(&output);
    assert_eq!(values[0]["code"], "unknownTemplate");
    assert_eq!(values[0]["expectedSequence"], 1);
}

struct FailingShell(AtomicBool);

impl ShellProvider for FailingShell {
    fn request_redraw(&self) {
        assert!(!self.0.load(Ordering::SeqCst), "platform failed at release");
    }
}

#[test]
fn real_native_application_failure_sends_fatal_and_never_admits_the_next_packet() {
    let shell = Arc::new(FailingShell(AtomicBool::new(false)));
    let document = NativeDocument::new(DocumentConfig {
        shell_provider: Some(shell.clone()),
        style_threading: StyleThreading::Sequential,
        ..DocumentConfig::default()
    });
    shell.0.store(true, Ordering::SeqCst);
    let output = Output::default();
    let (mut driver, input, wakes) =
        start_session(PublicationSession::new(document), output.clone());
    input.send(framed(&mount())).unwrap();
    input.send(framed(&empty(2))).unwrap();
    drop(input);
    let DriverStatus::Failed(failure) = finish(&mut driver, &wakes) else {
        panic!("native failure was not terminal")
    };
    assert_eq!(failure.code, "publicationFatal");
    assert!(driver.session().document().is_failed());
    assert_eq!(driver.session().expected_sequence(), Some(1));
    let values = replies(&output);
    assert_eq!(values.len(), 1);
    assert_eq!(values[0]["status"], "fatal");
    assert_eq!(values[0]["code"], "acceptanceUnknown");
    assert_eq!(values[0]["expectedSequence"], 1);
}

struct PanickingInput;

impl Read for PanickingInput {
    fn read(&mut self, _: &mut [u8]) -> io::Result<usize> {
        panic!("input worker lost");
    }
}

#[test]
fn worker_panic_is_reported_and_wakes_the_waiting_document_thread() {
    let (wake_sender, wakes) = mpsc::sync_channel(1);
    let (document, _) = host();
    let mut driver = ProcessDriver::start(
        PublicationSession::new(document),
        PanickingInput,
        Output::default(),
        Arc::new(move || {
            let _ = wake_sender.try_send(());
        }),
    )
    .unwrap();
    let DriverStatus::Failed(failure) = finish(&mut driver, &wakes) else {
        panic!("worker panic was ignored")
    };
    assert_eq!(failure.code, "readerWorkerLost");
    assert!(driver.session().is_closed());
    assert_eq!(driver.session().document().owner_count(), 0);
}

#[test]
fn untrusted_refusal_diagnostic_is_bounded_without_losing_its_machine_code() {
    let output = Output::default();
    let (mut driver, input, wakes) = start(output.clone());
    let mut packet = mount();
    packet.as_object_mut().unwrap().remove("templates");
    packet["operations"][0]["template"] = Value::String("large-key".repeat(1024));
    input.send(framed(&packet)).unwrap();
    drop(input);
    assert_eq!(finish(&mut driver, &wakes), DriverStatus::Finished);
    let values = replies(&output);
    assert_eq!(values[0]["code"], "unknownTemplate");
    assert_eq!(values[0]["message"].as_str().unwrap().chars().count(), 512);
    assert_eq!(values[0]["expectedSequence"], 1);
}
