mod output;
mod renderer;
mod styles;
mod text;

use gpui::{
    App, Bounds, Context, FocusHandle, KeyBinding, Render, TitlebarOptions, Window, WindowBounds,
    WindowOptions, actions, div, prelude::*, px, rgb, size,
};
use memoized_dom_desktop_host::{Scene, bridge::process_line_with_prepare};
use output::Output;
use renderer::{ClickSink, Renderer};
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
        let sink: ClickSink = Rc::new(move |handle, site, cx| {
            let _ = weak.update(cx, |view, cx| {
                if view.scene.has_event(handle, site)
                    && let Err(error) = view
                        .output
                        .send(&json!({"type":"event", "handle":handle, "site":site}))
                {
                    eprintln!("Desktop event bridge failed: {error}");
                    cx.quit();
                }
            });
        });
        div()
            .id("desktop-window")
            .track_focus(&self.focus)
            .key_context("desktop")
            .on_action(cx.listener(Self::focus_next))
            .on_action(cx.listener(Self::focus_previous))
            .size_full()
            .flex()
            .flex_col()
            .overflow_y_scroll()
            .p_8()
            .bg(rgb(0xf8fafc))
            .text_color(rgb(0x0f172a))
            .font_family("Segoe UI")
            .text_size(px(20.))
            .child(self.renderer.element(&self.scene, sink, cx))
    }
}

fn main() {
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
        });
        let root = view.clone();
        let bounds = Bounds::centered(None, size(px(800.), px(760.)), cx);
        if let Err(error) = cx.open_window(
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
            eprintln!("Unable to open desktop window: {error}");
            cx.quit();
            return;
        }
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
        cx.spawn(async move |cx| {
            while let Ok(line) = receiver.recv().await {
                let shutdown = cx.update(|cx| {
                    view.update(cx, |view, cx| {
                        let mut outcome =
                            process_line_with_prepare(&mut view.scene, &line, |template| {
                                view.renderer.prepare(template)
                            });
                        if outcome.inspect {
                            outcome.response["result"]["renderer"] =
                                json!(&*view.renderer.stats.borrow());
                        }
                        if let Err(error) = view.output.send(&outcome.response) {
                            eprintln!("Desktop response bridge failed: {error}");
                            return true;
                        }
                        if outcome.changed {
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
