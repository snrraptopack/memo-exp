//! Debug-window commands exercise the same EntityInputHandler used by the OS.
use super::{Backspace, SelectAll, TextInput};
use gpui::{Context, EntityInputHandler, Window};
use memoized_dom_desktop_host::Handle;
use serde::Deserialize;
use serde_json::Value;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub id: u64,
    version: u8,
    kind: String,
    pub handle: Handle,
    pub node: usize,
    pub action: String,
    pub text: Option<String>,
}
pub fn decode(line: &str) -> Option<Result<Request, Value>> {
    let value: Value = serde_json::from_str(line).ok()?;
    if value["kind"] != "test_input" {
        return None;
    }
    Some(
        serde_json::from_value::<Request>(value.clone())
            .map_err(|error| serde_json::json!({"id":value["id"],"error":error.to_string()})),
    )
}
impl Request {
    pub fn apply(
        &self,
        input: &mut TextInput,
        window: &mut Window,
        cx: &mut Context<TextInput>,
    ) -> Result<(), String> {
        if self.version != 1 || self.kind != "test_input" {
            return Err("Invalid native input test version".into());
        }
        window.focus(&input.focus, cx);
        match self.action.as_str() {
            "insert" => input.replace_text_in_range(
                None,
                self.text.as_deref().ok_or("Missing input text")?,
                window,
                cx,
            ),
            "compose" => input.replace_and_mark_text_in_range(
                None,
                self.text.as_deref().ok_or("Missing composition text")?,
                None,
                window,
                cx,
            ),
            "commit" => input.replace_text_in_range(
                None,
                self.text.as_deref().ok_or("Missing committed text")?,
                window,
                cx,
            ),
            "backspace" => input.backspace(&Backspace, window, cx),
            "select-all" => input.select_all(&SelectAll, window, cx),
            _ => return Err("Unknown native input test action".into()),
        }
        Ok(())
    }
}
