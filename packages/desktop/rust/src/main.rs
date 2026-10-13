//! One native host executable; the private headless mode exercises its stream.
//! Window creation and ordinary mounted TSX are subsequent implementation gates.

use std::io;
use std::process::ExitCode;
use std::sync::{Arc, mpsc};

use blitz_dom::DocumentConfig;
use memoized_dom_desktop::document::NativeDocument;
use memoized_dom_desktop::protocol::{DriverStatus, ProcessDriver, PublicationSession};

fn main() -> ExitCode {
    if std::env::args().skip(1).collect::<Vec<_>>() != ["--headless"] {
        eprintln!("The mounted window is not implemented yet. Private host mode: --headless");
        return ExitCode::FAILURE;
    }
    match run_headless() {
        Ok(DriverStatus::Finished) => ExitCode::SUCCESS,
        Ok(DriverStatus::Failed(failure)) => {
            eprintln!("desktop connection {}: {}", failure.code, failure.message);
            ExitCode::FAILURE
        }
        Ok(DriverStatus::Running) => unreachable!("headless driver still running"),
        Err(error) => {
            eprintln!("desktop worker startup failed: {error}");
            ExitCode::FAILURE
        }
    }
}

fn run_headless() -> io::Result<DriverStatus> {
    let (wake_sender, wakes) = mpsc::sync_channel(1);
    let wake = Arc::new(move || {
        // Coalesce wakes. A full channel already schedules the document thread.
        let _ = wake_sender.try_send(());
    });
    let session = PublicationSession::new(NativeDocument::new(DocumentConfig::default()));
    let mut driver = ProcessDriver::start(session, io::stdin(), io::stdout(), wake)?;
    loop {
        match driver.poll() {
            DriverStatus::Running => {
                // This is the headless document thread, not a native UI loop.
                // The window version will schedule poll via an event-loop proxy.
                if wakes.recv().is_err() {
                    driver.close();
                }
            }
            _ => return Ok(driver.finish_headless()),
        }
    }
}
