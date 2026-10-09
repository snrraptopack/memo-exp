//! Diagnostic process bridge. stdout is reserved for protocol responses.
use memoized_dom_desktop_host::{Scene, bridge::process_line};
use std::io::{self, BufRead, Write};

fn main() -> io::Result<()> {
    let mut scene = Scene::default();
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    for line in stdin.lock().lines() {
        let outcome = process_line(&mut scene, &line?);
        serde_json::to_writer(&mut stdout, &outcome.response)?;
        writeln!(stdout)?;
        stdout.flush()?;
        if outcome.shutdown {
            break;
        }
    }
    Ok(())
}
