//! Measured inline hover and pointer routing. Application bubbling stays in Bun.
use super::{
    TextCache,
    geometry::{self, InlineRun},
};
use crate::events::{self, Emission, EventSink};
use gpui::{
    App, Bounds, ClickEvent, DispatchPhase, FocusHandle, Hitbox, MouseButton, MouseClickEvent,
    MouseDownEvent, MouseMoveEvent, MouseUpEvent, Pixels, Window,
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
        // A clipped paragraph can retain a listener from its last painted frame.
        // Its current prepaint bounds still retire or route that listener safely.
        cache.bounds.unwrap_or(bounds),
        shaped.key.style.text_align,
        position,
    )
    .cloned()
}

/// Paint may be skipped outside the content mask. Prepaint still knows the
/// actual placed bounds, so an offscreen source cannot keep stale hover styling.
pub fn retire_displaced_hover(
    cache: &mut TextCache,
    runs: &[InlineRun],
    window: &mut Window,
    cx: &mut App,
) {
    if cache.hovered.is_empty() {
        return;
    }
    let position = window.mouse_position();
    let under_pointer = cache.bounds.and_then(|bounds| {
        window
            .content_mask()
            .bounds
            .contains(&position)
            .then(|| hit(cache, runs, bounds, position))
            .flatten()
    });
    if under_pointer.as_ref().map(|run| run.sources.as_ref()) != Some(cache.hovered.as_ref()) {
        cache.hovered = Arc::from([]);
        let current_view = window.current_view();
        // GPUI records invalidation during drawing without requesting a frame.
        // Notify after the draw effect cycle so the normal text gets painted.
        cx.defer(move |cx| cx.notify(current_view));
    }
}

/// Observe every move in capture so leaving a paragraph clears its state even
/// when another element consumes the bubbling event. This never emits a Bun event.
pub fn install_hover(
    cache: Rc<RefCell<TextCache>>,
    runs: Vec<InlineRun>,
    bounds: Bounds<Pixels>,
    hitbox: Hitbox,
    window: &mut Window,
    cx: &mut App,
) {
    let current_view = window.current_view();
    let update = move |position, window: &Window, cx: &mut App| {
        let mut cache = cache.borrow_mut();
        let sources = if hitbox.is_hovered(window) {
            hit(&cache, &runs, bounds, position).map_or_else(|| Arc::from([]), |run| run.sources)
        } else {
            Arc::from([])
        };
        if cache.hovered != sources {
            cache.hovered = sources;
            cx.defer(move |cx| cx.notify(current_view));
        }
    };
    // Revalidate on paint as well: scrolling, resizing, and accepted text edits
    // can move glyphs under a stationary pointer without a mouse-move event.
    update(window.mouse_position(), window, cx);
    window.on_mouse_event(move |event: &MouseMoveEvent, phase, window, cx| {
        if phase == DispatchPhase::Capture {
            update(event.position, window, cx);
        }
    });
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
