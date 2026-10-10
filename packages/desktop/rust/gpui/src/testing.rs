//! Debug-only platform event injection; uses the real hit tests and scroll handler.
use crate::DesktopView;
use gpui::{
    App, Entity, KeyDownEvent, KeyUpEvent, Keystroke, MouseButton, MouseDownEvent, MouseUpEvent,
    PlatformInput, ScrollDelta, ScrollWheelEvent, Window, point, px, size,
};
use memoized_dom_desktop_host::Handle;
use serde::Deserialize;
use serde_json::{Value, json};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WindowRequest {
    pub id: u64,
    version: u8,
    kind: String,
    action: String,
    handle: Option<Handle>,
    node: Option<usize>,
    delta: Option<f32>,
    width: Option<f32>,
    height: Option<f32>,
    key: Option<String>,
    phase: Option<String>,
}
pub enum Request {
    Input(crate::input::testing::Request),
    Window(WindowRequest),
}
pub fn decode(line: &str) -> Option<Result<Request, Value>> {
    let value: Value = serde_json::from_str(line).ok()?;
    if value["kind"] == "test_input" {
        return crate::input::testing::decode(line).map(|request| request.map(Request::Input));
    }
    if value["kind"] != "test_window" {
        return None;
    }
    Some(
        serde_json::from_value(value.clone())
            .map(Request::Window)
            .map_err(|error| json!({"id":value["id"],"error":error.to_string()})),
    )
}
impl Request {
    pub fn id(&self) -> u64 {
        match self {
            Self::Input(request) => request.id,
            Self::Window(request) => request.id,
        }
    }
    pub fn apply(
        &self,
        view: &Entity<DesktopView>,
        window: &mut Window,
        cx: &mut App,
    ) -> Result<(), String> {
        match self {
            Self::Input(request) => {
                let root = view.read(cx);
                let input = root.renderer.test_input(&root.scene, request)?;
                input.update(cx, |input, cx| request.apply(input, window, cx))
            }
            Self::Window(request) => request.apply(view, window, cx),
        }
    }
}
impl WindowRequest {
    pub fn apply(
        &self,
        view: &Entity<DesktopView>,
        window: &mut Window,
        cx: &mut App,
    ) -> Result<(), String> {
        if self.version != 1 || self.kind != "test_window" {
            return Err("Invalid native window test version".into());
        }
        match self.action.as_str() {
            "key" => {
                let keystroke =
                    Keystroke::parse(self.key.as_deref().ok_or("Missing test keystroke")?)
                        .map_err(|error| error.to_string())?;
                match self.phase.as_deref().unwrap_or("down") {
                    "down" => window.dispatch_event(
                        PlatformInput::KeyDown(KeyDownEvent {
                            keystroke,
                            is_held: false,
                            prefer_character_input: false,
                        }),
                        cx,
                    ),
                    "up" => {
                        window.dispatch_event(PlatformInput::KeyUp(KeyUpEvent { keystroke }), cx)
                    }
                    _ => return Err("Invalid key phase".into()),
                };
            }
            "resize" => {
                let dimension = |value: Option<f32>| {
                    value
                        .filter(|value| value.is_finite() && *value >= 320. && *value <= 4096.)
                        .ok_or("Missing valid resize dimension")
                };
                window.resize(size(
                    px(dimension(self.width)?),
                    px(dimension(self.height)?),
                ));
            }
            "click" => {
                let handle = self.handle.ok_or("Missing click owner")?;
                let node = self.node.ok_or("Missing click node")?;
                let position = {
                    let view = view.read(cx);
                    let stats = view.renderer.stats.borrow();
                    let bounds = stats
                        .boxes
                        .iter()
                        .find(|bounds| bounds.handle == handle && bounds.source == node)
                        .ok_or("Target was not painted")?;
                    point(
                        px(bounds.x + bounds.width / 2.),
                        px(bounds.y + bounds.height / 2.),
                    )
                };
                if !view.read(cx).scroll.bounds().contains(&position) {
                    return Err("Test button is outside the viewport".into());
                }
                window.dispatch_event(
                    PlatformInput::MouseDown(MouseDownEvent {
                        button: MouseButton::Left,
                        position,
                        click_count: 1,
                        ..Default::default()
                    }),
                    cx,
                );
                window.dispatch_event(
                    PlatformInput::MouseUp(MouseUpEvent {
                        button: MouseButton::Left,
                        position,
                        click_count: 1,
                        ..Default::default()
                    }),
                    cx,
                );
            }
            "scroll" => {
                let delta = self
                    .delta
                    .filter(|delta| delta.is_finite())
                    .ok_or("Missing finite scroll delta")?;
                window.dispatch_event(
                    PlatformInput::ScrollWheel(ScrollWheelEvent {
                        position: view.read(cx).scroll.bounds().center(),
                        delta: ScrollDelta::Pixels(point(px(0.), px(delta))),
                        ..Default::default()
                    }),
                    cx,
                );
            }
            _ => return Err("Unknown native window test action".into()),
        }
        Ok(())
    }
}
