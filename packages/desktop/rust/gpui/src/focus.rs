//! Imperative focus uses the same retained handles and subscriptions as input.
use crate::DesktopView;
use gpui::{Context, Window};
use memoized_dom_desktop_host::bridge::FocusRequest;
use serde_json::{Value, json};
mod scroll;

type Step = fn(&mut DesktopView, &mut Window, &mut Context<DesktopView>, FocusRequest, Value);

pub fn request(
    view: &mut DesktopView,
    window: &mut Window,
    cx: &mut Context<DesktopView>,
    command: FocusRequest,
    id: Value,
) {
    match view.renderer.set_focus(&view.scene, command, window, cx) {
        // Accepted refs can bind before a frame creates their retained control.
        Ok(false) => retry(window, cx, command, id, request),
        Ok(true)
            if command.focused
                && !command.prevent_scroll
                && view.scene.has_focus_control(command.handle, command.node) =>
        {
            reveal(view, window, cx, command, id);
        }
        Ok(true) => respond(view, cx, id, Ok(())),
        Err(error) => respond(view, cx, id, Err(error)),
    }
}

fn reveal(
    view: &mut DesktopView,
    window: &mut Window,
    cx: &mut Context<DesktopView>,
    command: FocusRequest,
    id: Value,
) {
    if !view.scene.has_element(command.handle, command.node) {
        respond(
            view,
            cx,
            id,
            Err("Focus requires a live element source".into()),
        );
        return;
    }
    if view.renderer.focused(window) != Some((command.handle, command.node)) {
        // A newer interaction owns focus. A delayed reveal must not steal it
        // back or scroll toward the previous control.
        respond(view, cx, id, Ok(()));
        return;
    }
    let current = view.scroll.offset();
    let planned = if view.renderer.stats.borrow().viewport != window.viewport_size() {
        Ok(None)
    } else {
        scroll::plan(
            &view.renderer.stats.borrow(),
            view.scene.sequence(),
            command,
            view.scroll.bounds(),
            current,
            view.scroll.max_offset(),
        )
    };
    match planned {
        Ok(None) => retry(window, cx, command, id, reveal),
        Ok(Some(offset)) => {
            if offset != current {
                view.scroll.set_offset(offset);
                cx.notify();
            }
            respond(view, cx, id, Ok(()));
        }
        Err(error) => respond(view, cx, id, Err(error)),
    }
}

fn retry(
    window: &mut Window,
    cx: &mut Context<DesktopView>,
    command: FocusRequest,
    id: Value,
    step: Step,
) {
    // Frame callbacks precede drawing. A later attempt rechecks generation,
    // focus ownership, focused styling and the painted coordinate context.
    cx.notify();
    let owner = cx.entity().downgrade();
    window.on_next_frame(move |window, cx| {
        let _ = owner.update(cx, |view, cx| step(view, window, cx, command, id));
    });
}

fn respond(
    view: &DesktopView,
    cx: &mut Context<DesktopView>,
    id: Value,
    result: Result<(), String>,
) {
    let response = match result {
        Ok(()) => json!({"id":id,"result":null}),
        Err(error) => json!({"id":id,"error":error}),
    };
    if let Err(error) = view.output.send(&response) {
        eprintln!("Desktop focus bridge failed: {error}");
        cx.quit();
    }
}
