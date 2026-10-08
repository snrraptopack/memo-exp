//! Diagnostic process bridge. stdout is reserved for protocol responses.
use memoized_dom_desktop_host::{Scene, Template, Transaction};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{self, BufRead, Write};

#[derive(Deserialize)]
struct Request {
    id: u64,
    version: u8,
    #[serde(flatten)]
    command: Command,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Command {
    Install { template: Template },
    Apply { transaction: Transaction },
    Inspect,
    Shutdown,
}

fn execute(scene: &mut Scene, command: Command) -> Result<Value, String> {
    match command {
        Command::Install { template } => {
            scene.install(template)?;
            Ok(Value::Null)
        }
        Command::Apply { transaction } => Ok(json!({"sequence":scene.commit(transaction)?})),
        Command::Inspect => {
            serde_json::to_value(scene.snapshot()).map_err(|error| error.to_string())
        }
        Command::Shutdown => Ok(Value::Null),
    }
}

fn main() -> io::Result<()> {
    let mut scene = Scene::default();
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    for line in stdin.lock().lines() {
        let line = line?;
        let parsed = serde_json::from_str::<Request>(&line);
        let mut stop = false;
        let response = match parsed {
            Ok(request) => {
                stop = matches!(request.command, Command::Shutdown);
                let result = if request.version != 1 {
                    Err("Unsupported desktop protocol version".into())
                } else {
                    execute(&mut scene, request.command)
                };
                match result {
                    Ok(value) => json!({"id":request.id,"result":value}),
                    Err(error) => json!({"id":request.id,"error":error}),
                }
            }
            Err(error) => {
                // Preserve a valid request identity even when an operation is malformed.
                let id = serde_json::from_str::<Value>(&line)
                    .ok()
                    .and_then(|value| value.get("id").and_then(Value::as_u64));
                json!({"id":id,"error":error.to_string()})
            }
        };
        serde_json::to_writer(&mut stdout, &response)?;
        writeln!(stdout)?;
        stdout.flush()?;
        if stop {
            break;
        }
    }
    Ok(())
}
