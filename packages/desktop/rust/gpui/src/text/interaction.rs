//! Pointer routing for measured inline text. Application bubbling stays in Bun.
use super::{
    TextCache,
    geometry::{self, InlineRun},
};
use crate::events::{self, Emission, EventSink};
use gpui::{
    App, Bounds, ClickEvent, DispatchPhase, FocusHandle, Hitbox, MouseButton, MouseClickEvent,
    MouseDownEvent, MouseUpEvent, Pixels, Window,
};
use memoized_dom_desktop_host::{presentation::TextSource, template::EventKind};
use std::{cell::RefCell, rc::Rc, sync::Arc};

pub struct InlineInput {
    pub root: TextSource,
    pub focus: Option<FocusHandle>,
    pub sink: EventSink,
    pub pointer_down: bool,
    pub pointer_up: bool,
}

pub struct Pressed {
    sources: Arc<[TextSource]>,
    event: MouseDownEvent,
}

fn hit(
    cache: &TextCache,
    runs: &[InlineRun],
    bounds: Bounds<Pixels>,
    position: gpui::Point<Pixels>,
) -> Option<InlineRun> {
    let shaped = cache.active.and_then(|index| cache.shaped.get(index))?;
    geometry::hit_source(
        shaped.cells.as_deref()?,
        runs,
        bounds,
        shaped.key.style.text_align,
        position,
    )
    .cloned()
}

pub fn install(
    input: InlineInput,
    cache: Rc<RefCell<TextCache>>,
    runs: Vec<InlineRun>,
    bounds: Bounds<Pixels>,
    hitbox: Hitbox,
    window: &mut Window,
) {
    let pressed = cache
        .borrow_mut()
        .pressed
        .get_or_insert_with(Default::default)
        .clone();
    let runs: Arc<[InlineRun]> = runs.into();
    window.on_mouse_event({
        let pressed = pressed.clone();
        let cache = cache.clone();
        let runs = runs.clone();
        let hitbox = hitbox.clone();
        let sink = input.sink.clone();
        move |event: &MouseDownEvent, phase, window, cx| {
            if phase == DispatchPhase::Capture {
                // Reset even when a different element receives the next press.
                pressed.borrow_mut().take();
                return;
            }
            if event.button != MouseButton::Left || !hitbox.is_hovered(window) {
                return;
            }
            let run = hit(&cache.borrow(), &runs, bounds, event.position);
            let sources = run
                .as_ref()
                .map_or_else(|| Arc::from([]), |run| run.sources.clone());
            *pressed.borrow_mut() = Some(Pressed {
                sources,
                event: event.clone(),
            });
            if let Some(target) = run.and_then(|run| run.sources.last().copied()) {
                // The enclosing button still owns native focus, even when a
                // nested span becomes the authored pointer/click target.
                if let Some(focus) = &input.focus {
                    window.focus(focus, cx);
                }
                if input.pointer_down {
                    sink(
                        Emission::new(
                            target.handle,
                            target.node,
                            EventKind::PointerDown,
                            events::pointer(event.position, event.button, true, event.modifiers),
                        ),
                        cx,
                    );
                }
                cx.stop_propagation();
                window.refresh();
            }
        }
    });
    window.on_mouse_event({
        let mut release = None;
        move |event: &MouseUpEvent, phase, window, cx: &mut App| {
            if phase == DispatchPhase::Capture {
                // Retire the press on every release, including outside the
                // paragraph, so a later mouse-up cannot reuse stale history.
                release = pressed.borrow_mut().take();
                return;
            }
            if event.button != MouseButton::Left || !hitbox.is_hovered(window) {
                return;
            }
            let run = hit(&cache.borrow(), &runs, bounds, event.position);
            if release.is_none() && run.is_none() {
                return;
            }
            let up = run
                .as_ref()
                .and_then(|run| run.sources.last())
                .copied()
                .unwrap_or(input.root);
            if input.pointer_up {
                (input.sink)(
                    Emission::new(
                        up.handle,
                        up.node,
                        EventKind::PointerUp,
                        events::pointer(event.position, event.button, false, event.modifiers),
                    ),
                    cx,
                );
            }
            if let Some(down) = release.take() {
                let sources = run.as_ref().map_or(&[][..], |run| run.sources.as_ref());
                let common = down
                    .sources
                    .iter()
                    .zip(sources)
                    .take_while(|(left, right)| left == right)
                    .last()
                    .map(|(source, _)| *source)
                    .unwrap_or(input.root);
                let click = ClickEvent::Mouse(MouseClickEvent {
                    down: down.event,
                    up: event.clone(),
                });
                // Pointer-up was already delivered above. Emit one click to
                // the common authored element and let Bun handle its path.
                events::emit_click(&input.sink, common.handle, common.node, &click, false, cx);
            }
            cx.stop_propagation();
        }
    });
}
