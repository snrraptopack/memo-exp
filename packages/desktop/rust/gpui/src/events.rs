//! Native field translation and deferred focus defaults. Authored bubbling is in Bun.
use gpui::{App, ClickEvent, Keystroke, Modifiers, MouseButton, Pixels, Point};
use memoized_dom_desktop_host::{Handle, template::EventKind};
use serde_json::{Value, json};
use std::rc::Rc;

pub struct Emission {
    pub handle: Handle,
    pub node: usize,
    pub kind: EventKind,
    pub payload: Value,
    pub edit: Option<u64>,
    /// Deferred Tab traversal: true moves backward, false moves forward.
    pub navigation: Option<bool>,
}
pub type EventSink = Rc<dyn Fn(Emission, &mut App)>;

pub fn modifiers(value: Modifiers) -> Value {
    json!({
        "ctrlKey": value.control,
        "shiftKey": value.shift,
        "altKey": value.alt,
        "metaKey": value.platform,
    })
}
pub fn keyboard(stroke: &Keystroke, repeat: bool, cancelable: bool) -> Value {
    let key = match stroke.key.as_str() {
        "enter" => "Enter",
        "tab" => "Tab",
        "space" => " ",
        "escape" => "Escape",
        "backspace" => "Backspace",
        "delete" => "Delete",
        "left" => "ArrowLeft",
        "right" => "ArrowRight",
        "up" => "ArrowUp",
        "down" => "ArrowDown",
        "home" => "Home",
        "end" => "End",
        _ => stroke.key_char.as_deref().unwrap_or(&stroke.key),
    };
    let mut result = modifiers(stroke.modifiers);
    result["key"] = json!(key);
    result["repeat"] = json!(repeat);
    result["isComposing"] = json!(false);
    result["cancelable"] = json!(cancelable);
    result
}
pub fn pointer(
    position: Point<Pixels>,
    button: MouseButton,
    pressed: bool,
    mods: Modifiers,
) -> Value {
    let mut result = modifiers(mods);
    let button = match button {
        MouseButton::Left => 0,
        MouseButton::Middle => 1,
        MouseButton::Right => 2,
        _ => 0,
    };
    result["clientX"] = json!(position.x.as_f32());
    result["clientY"] = json!(position.y.as_f32());
    result["button"] = json!(button);
    result["buttons"] = json!(if pressed {
        match button {
            0 => 1,
            1 => 4,
            _ => 2,
        }
    } else {
        0
    });
    result["pointerId"] = json!(1);
    result["pointerType"] = json!("mouse");
    result["isPrimary"] = json!(true);
    // Editing/focus remain synchronous native operations; these notifications
    // are explicitly non-cancelable until native editing defaults are deferred.
    result["cancelable"] = json!(false);
    result
}
pub fn click(event: &ClickEvent) -> Value {
    let mut result = pointer(
        event.position(),
        if event.is_right_click() {
            MouseButton::Right
        } else if event.is_middle_click() {
            MouseButton::Middle
        } else {
            MouseButton::Left
        },
        false,
        event.modifiers(),
    );
    result["detail"] = json!(event.click_count());
    result["cancelable"] = json!(true);
    result
}

impl Emission {
    pub fn new(handle: Handle, node: usize, kind: EventKind, mut payload: Value) -> Self {
        payload["type"] = serde_json::to_value(kind).expect("event kind serializes");
        payload["isTrusted"] = json!(true);
        Self {
            handle,
            node,
            kind,
            payload,
            edit: None,
            navigation: None,
        }
    }
}
