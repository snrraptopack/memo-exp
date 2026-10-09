//! Debug-only platform event injection; uses the real hit tests and scroll handler.
use crate::DesktopView;
use gpui::{
    App, Context, MouseButton, MouseDownEvent, MouseUpEvent, PlatformInput, ScrollDelta,
    ScrollWheelEvent, Window, point, px,
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
        view: &mut DesktopView,
        window: &mut Window,
        cx: &mut Context<DesktopView>,
    ) -> Result<(), String> {
        match self {
            Self::Input(request) => view.renderer.test_input(&view.scene, request, window, cx),
            Self::Window(request) => request.apply(view, window, cx),
        }
    }
}
impl WindowRequest {
    pub fn apply(
        &self,
        view: &mut DesktopView,
        window: &mut Window,
        cx: &mut App,
    ) -> Result<(), String> {
        if self.version != 1 || self.kind != "test_window" {
            return Err("Invalid native window test version".into());
        }
        match self.action.as_str() {
            "click" => {
                let handle = self.handle.ok_or("Missing click owner")?;
                let node = self.node.ok_or("Missing click node")?;
                let position = {
                    let stats = view.renderer.stats.borrow();
                    let bounds = stats
                        .boxes
                        .iter()
                        .find(|bounds| {
                            bounds.handle == handle
                                && bounds.source == node
                                && bounds.tag == "button"
                        })
                        .ok_or("Button was not painted")?;
                    point(
                        px(bounds.x + bounds.width / 2.),
                        px(bounds.y + bounds.height / 2.),
                    )
                };
                if !view.scroll.bounds().contains(&position) {
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
                        position: view.scroll.bounds().center(),
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
