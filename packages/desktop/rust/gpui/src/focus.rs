//! Imperative focus uses the same retained handles and subscriptions as input.
use crate::DesktopView;
use gpui::{Context, Window};
use memoized_dom_desktop_host::bridge::FocusRequest;
use serde_json::{Value, json};

pub fn request(
    view: &mut DesktopView,
    window: &mut Window,
    cx: &mut Context<DesktopView>,
    command: FocusRequest,
    id: Value,
) {
    let result = view.renderer.set_focus(&view.scene, command, window, cx);
    if matches!(result, Ok(false)) {
        // Accepted refs can bind before the first render creates their control.
        // GPUI frame callbacks run before drawing, so retry on a later frame and
        // revalidate the accepted source on every attempt.
        cx.notify();
        let owner = cx.entity().downgrade();
        window.on_next_frame(move |window, cx| {
            let _ = owner.update(cx, |view, cx| request(view, window, cx, command, id));
        });
        return;
    }
    let response = match result {
        Ok(true) => json!({"id":id,"result":null}),
        Err(error) => json!({"id":id,"error":error}),
        Ok(false) => unreachable!(),
    };
    if let Err(error) = view.output.send(&response) {
        eprintln!("Desktop focus bridge failed: {error}");
        cx.quit();
    }
}
