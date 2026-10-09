mod input;
mod output;
mod renderer;
mod styles;
#[cfg(debug_assertions)]
mod testing;
mod text;

use gpui::{
    App, Bounds, Context, FocusHandle, KeyBinding, Render, ScrollHandle, TitlebarOptions, Window,
    WindowBounds, WindowOptions, actions, div, prelude::*, px, size,
};
use memoized_dom_desktop_host::{Scene, bridge::process_line_with_prepare};
use output::Output;
use renderer::{EventSink, Renderer};
actions!(desktop, [FocusNext, FocusPrevious]);
use serde_json::json;
use std::{
    io::{self, BufRead},
    rc::Rc,
};

struct DesktopView {
    scene: Scene,
    renderer: Renderer,
    output: Output,
    focus: FocusHandle,
    scroll: ScrollHandle,
}
impl DesktopView {
    fn focus_next(&mut self, _: &FocusNext, window: &mut Window, cx: &mut Context<Self>) {
        window.focus_next(cx);
    }
    fn focus_previous(&mut self, _: &FocusPrevious, window: &mut Window, cx: &mut Context<Self>) {
        window.focus_prev(cx);
    }
}
impl Render for DesktopView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl gpui::IntoElement {
        let weak = cx.weak_entity();
        let stats = self.renderer.stats.clone();
        let sink: EventSink = Rc::new(move |handle, site, payload, edit, cx| {
            stats.borrow_mut().event_started();
            let weak = weak.clone();
            cx.defer(move |cx| {
                let _ = weak.update(cx, |view, cx| {
                    if view.scene.has_event(handle, site) {
                        let mut event = json!({"type":"event", "handle":handle, "site":site});
                        if let Some(payload) = payload {
                            event["payload"] = payload;
                        }
                        if let Some(edit) = edit {
                            event["edit"] = json!(edit);
                        }
                        if let Err(error) = view.output.send(&event) {
                            eprintln!("Desktop event bridge failed: {error}");
                            cx.quit();
                        }
                    }
                });
            });
        });
        div()
            .id("desktop-window")
            .track_focus(&self.focus)
            .key_context("desktop")
            .on_action(cx.listener(Self::focus_next))
            .on_action(cx.listener(Self::focus_previous))
            .size_full()
            .block()
            .overflow_y_scroll()
            .track_scroll(&self.scroll)
            .child(self.renderer.element(&self.scene, sink, cx))
    }
}

fn main() {
    #[cfg(debug_assertions)]
    let smoke = std::env::args().any(|arg| arg == "--smoke");
    let (sender, receiver) = async_channel::bounded::<String>(256);
    std::thread::spawn(move || {
        for line in io::stdin().lock().lines() {
            match line {
                Ok(line) => {
                    if sender.send_blocking(line).is_err() {
                        break;
                    }
                }
                _ => break,
            }
        }
    });
    gpui_platform::application().run(move |cx: &mut App| {
        input::bind_keys(cx);
        cx.bind_keys([
            KeyBinding::new("tab", FocusNext, Some("desktop")),
            KeyBinding::new("shift-tab", FocusPrevious, Some("desktop")),
        ]);
        let output = Output::new();
        let view = cx.new(|cx| DesktopView {
            scene: Scene::default(),
            renderer: Renderer::default(),
            output: output.clone(),
            focus: cx.focus_handle().tab_stop(false),
            scroll: ScrollHandle::new(),
        });
        let root = view.clone();
        let bounds = Bounds::centered(None, size(px(800.), px(760.)), cx);
        let _window = match cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                titlebar: Some(TitlebarOptions {
                    title: Some("Memoized DOM Desktop".into()),
                    ..Default::default()
                }),
                ..Default::default()
            },
            move |window, cx| {
                let focus = root.read(cx).focus.clone();
                window.focus(&focus, cx);
                window.activate_window();
                root
            },
        ) {
            Ok(window) => window,
            Err(error) => {
                eprintln!("Unable to open desktop window: {error}");
                cx.quit();
                return;
            }
        };
        let closed_output = output.clone();
        cx.on_window_closed(move |cx, _| {
            if let Err(error) = closed_output.send(&json!({"type":"closed"})) {
                eprintln!("Desktop close bridge failed: {error}");
                cx.quit();
            }
        })
        .detach();
        if let Err(error) = output.send(&json!({"type":"ready"})) {
            eprintln!("Desktop startup bridge failed: {error}");
            cx.quit();
            return;
        }
        cx.activate(true);
        #[cfg(debug_assertions)]
        let test_output = output.clone();
        cx.spawn(async move |cx| {
            while let Ok(line) = receiver.recv().await {
                #[cfg(debug_assertions)]
                if smoke && let Some(request) = testing::decode(&line) {
                    cx.update(|cx| {
                        let response = match request {
                            Err(error) => error,
                            Ok(request) => {
                                let result = _window
                                    .update(cx, |view, window, cx| request.apply(view, window, cx))
                                    .map_err(|error| error.to_string())
                                    .and_then(|result| result);
                                match result {
                                    Ok(()) => json!({"id":request.id(),"result":null}),
                                    Err(error) => json!({"id":request.id(),"error":error}),
                                }
                            }
                        };
                        if let Err(error) = test_output.send(&response) {
                            eprintln!("Native window test failed: {error}");
                            cx.quit();
                        }
                    });
                    continue;
                }
                let shutdown = cx.update(|cx| {
                    view.update(cx, |view, cx| {
                        let mut outcome =
                            process_line_with_prepare(&mut view.scene, &line, |template| {
                                view.renderer.prepare(template)
                            });
                        if let Some((handle, site, edit)) = outcome.input_ack
                            && let Err(error) =
                                view.renderer
                                    .acknowledge(&view.scene, handle, site, edit, cx)
                        {
                            outcome.response["error"] = json!(error);
                        }
                        if outcome.inspect {
                            outcome.response["result"]["renderer"] =
                                json!(&*view.renderer.stats.borrow());
                            outcome.response["result"]["renderer"]["scroll"] = json!({
                                "offset": view.scroll.offset().y.as_f32(),
                                "max": view.scroll.max_offset().y.as_f32(),
                                "viewport": view.scroll.bounds().size.height.as_f32(),
                            });
                            #[cfg(debug_assertions)]
                            {
                                outcome.response["result"]["renderer"]["inputs"] =
                                    view.renderer.painted_inputs(cx);
                            }
                        }
                        if let Err(error) = view.output.send(&outcome.response) {
                            eprintln!("Desktop response bridge failed: {error}");
                            return true;
                        }
                        if outcome.changed {
                            if outcome.response["result"]["sequence"].is_number() {
                                view.renderer.stats.borrow_mut().committed();
                            }
                            cx.notify();
                        }
                        outcome.shutdown
                    })
                });
                if shutdown {
                    break;
                }
            }
            // EOF also retires the window when its Bun owner exits unexpectedly.
            cx.update(|cx| cx.quit());
        })
        .detach();
    });
}
