mod events;
mod input;
mod output;
mod renderer;
mod styles;
#[cfg(debug_assertions)]
mod testing;
mod text;

use gpui::{
    AnyWindowHandle, App, Bounds, Context, FocusHandle, Render, ScrollHandle, TitlebarOptions,
    Window, WindowBounds, WindowOptions, div, prelude::*, px, size,
};
use memoized_dom_desktop_host::{
    Scene,
    bridge::{Preparation, process_line_with_validation},
    template::EventKind,
};
use output::Output;
use renderer::{EventSink, Renderer};
use serde_json::json;
use std::{
    cell::RefCell,
    collections::BTreeMap,
    io::{self, BufRead},
    rc::Rc,
};

#[derive(Default)]
struct Navigation {
    next: u64,
    pending: BTreeMap<u64, (memoized_dom_desktop_host::Handle, usize, bool)>,
}

struct DesktopView {
    scene: Scene,
    renderer: Renderer,
    output: Output,
    focus: FocusHandle,
    scroll: ScrollHandle,
    navigation: Rc<RefCell<Navigation>>,
    live: Rc<RefCell<BTreeMap<u64, u64>>>,
}
impl Render for DesktopView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl gpui::IntoElement {
        let stats = self.renderer.stats.clone();
        let output = self.output.clone();
        let live = self.live.clone();
        let navigation = self.navigation.clone();
        let root_id = cx.entity_id();
        let routes: BTreeMap<_, _> = self
            .scene
            .instances()
            .flat_map(|instance| {
                instance
                    .template
                    .source
                    .events
                    .iter()
                    .enumerate()
                    .map(move |(site, event)| {
                        (
                            (
                                instance.handle.id,
                                instance.handle.generation,
                                event.node,
                                event.r#type,
                            ),
                            site,
                        )
                    })
            })
            .collect();
        // Focus notifications can run while the root entity is borrowed. Emitting
        // transport fields must never update that entity reentrantly.
        let sink: EventSink = Rc::new(move |emission, cx| {
            if live.borrow().get(&emission.handle.id) != Some(&emission.handle.generation) {
                return;
            }
            if matches!(emission.kind, EventKind::Focus | EventKind::Blur) {
                // Focus-dependent CSS needs a root render, but notifying does
                // not borrow the root entity during GPUI's focus callbacks.
                cx.notify(root_id);
                let route = (
                    emission.handle.id,
                    emission.handle.generation,
                    emission.node,
                    emission.kind,
                );
                if !routes.contains_key(&route) {
                    return;
                }
            }
            stats.borrow_mut().event_started();
            let mut event = json!({"type":"event", "handle":emission.handle, "node":emission.node, "payload":emission.payload});
            if let Some(site) = routes.get(&(
                emission.handle.id,
                emission.handle.generation,
                emission.node,
                emission.kind,
            )) {
                event["site"] = json!(site);
            }
            if let Some(reverse) = emission.navigation {
                let mut navigation = navigation.borrow_mut();
                if navigation.pending.len() >= 256 {
                    eprintln!("Desktop navigation queue exceeded its limit");
                    cx.quit();
                    return;
                }
                navigation.next += 1;
                let token = navigation.next;
                navigation
                    .pending
                    .insert(token, (emission.handle, emission.node, reverse));
                event["dispatch"] = json!(token);
            }
            if let Some(edit) = emission.edit {
                event["edit"] = json!(edit);
            }
            if let Err(error) = output.send(&event) {
                eprintln!("Desktop event bridge failed: {error}");
                cx.quit();
            }
        });
        div()
            .id("desktop-window")
            .track_focus(&self.focus)
            .on_key_down(|event, window, cx| {
                if event.keystroke.key == "tab" {
                    window.prevent_default();
                    cx.stop_propagation();
                    if event.keystroke.modifiers.shift {
                        window.focus_prev(cx);
                    } else {
                        window.focus_next(cx);
                    }
                }
            })
            .size_full()
            .block()
            .overflow_y_scroll()
            .track_scroll(&self.scroll)
            .child(self.renderer.element(&self.scene, sink, window, cx))
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
        let output = Output::new();
        let view = cx.new(|cx| DesktopView {
            scene: Scene::default(),
            renderer: Renderer::default(),
            output: output.clone(),
            focus: cx.focus_handle().tab_stop(false),
            scroll: ScrollHandle::new(),
            navigation: Rc::new(RefCell::new(Navigation::default())),
            live: Rc::new(RefCell::new(BTreeMap::new())),
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
                                // Platform dispatch may redraw the root (for example
                                // on a mouse/keyboard modality change). Do not borrow
                                // that entity while injecting an event.
                                let result = AnyWindowHandle::from(_window)
                                    .update(cx, |_, window, cx| request.apply(&view, window, cx))
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
                    _window
                        .update(cx, |view, window, cx| {
                            let mut outcome =
                                process_line_with_validation(&mut view.scene, &line, |candidate| {
                                    match candidate {
                                        Preparation::Template(template) => {
                                            view.renderer.prepare(template)
                                        }
                                        Preparation::Instances(instances) => {
                                            view.renderer.prepare_instances(instances)
                                        }
                                    }
                                });
                            if let Some((handle, site, edit)) = outcome.input_ack
                                && let Err(error) =
                                    view.renderer
                                        .acknowledge(&view.scene, handle, site, edit, cx)
                            {
                                outcome.response["error"] = json!(error);
                            }
                            if let Some((dispatch, prevented)) = outcome.event_result {
                                match view.navigation.borrow_mut().pending.remove(&dispatch) {
                                    Some((handle, node, reverse)) => {
                                        if !prevented {
                                            view.renderer
                                                .navigate(handle, node, reverse, window, cx);
                                        }
                                    }
                                    None => {
                                        outcome.response["error"] =
                                            json!("Unknown or already acknowledged event token")
                                    }
                                }
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
                                    outcome.response["result"]["renderer"]["focused"] =
                                        json!(view.renderer.focused(window).map(
                                            |(handle, node)| json!({"handle":handle,"node":node})
                                        ));
                                }
                            }
                            if let Err(error) = view.output.send(&outcome.response) {
                                eprintln!("Desktop response bridge failed: {error}");
                                return true;
                            }
                            if outcome.changed {
                                *view.live.borrow_mut() = view
                                    .scene
                                    .instances()
                                    .map(|instance| {
                                        (instance.handle.id, instance.handle.generation)
                                    })
                                    .collect();
                                if outcome.response["result"]["sequence"].is_number() {
                                    view.renderer.stats.borrow_mut().committed();
                                }
                                cx.notify();
                            }
                            outcome.shutdown
                        })
                        .unwrap_or_else(|error| {
                            eprintln!("Desktop window update failed: {error}");
                            true
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
