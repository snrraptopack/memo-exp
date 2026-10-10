//! GPUI adapter for prepared native flow; GPUI owns styling and Taffy layout.
use crate::{
    events::{self, Emission},
    input::{InputOptions, TextInput},
    styles::{self, NativeStyles, StyleCache},
    text::{Paragraph, TextCache},
};
use gpui::{prelude::*, *};
use memoized_dom_desktop_host::{
    Attachment, Handle, Scene,
    presentation::{ItemKind, TextValue},
    tags::{self, Layout},
    template::{EventKind, Node, PreparedTemplate, SlotKind},
};
use serde::Serialize;
use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    rc::Rc,
    sync::Arc,
    time::Instant,
};

#[derive(Default, Serialize)]
pub struct Stats {
    pub frames: u64,
    pub sequence: u64,
    pub shaping: u64,
    pub error: Option<String>,
    pub width: f32,
    pub height: f32,
    pub boxes: Vec<LayoutBox>,
    pub event_to_commit_ms: Option<f64>,
    pub event_to_paint_ms: Option<f64>,
    pub commit_to_paint_ms: Option<f64>,
    pub layout_ms: f64,
    pub frame_ms: f64,
    #[serde(skip)]
    event_started: Option<Instant>,
    #[serde(skip)]
    commit_started: Option<Instant>,
    #[serde(skip)]
    render_started: Option<Instant>,
}
impl Stats {
    pub fn event_started(&mut self) {
        self.event_started = Some(Instant::now());
        self.event_to_commit_ms = None;
        self.event_to_paint_ms = None;
    }
    pub fn committed(&mut self) {
        let now = Instant::now();
        self.event_to_commit_ms = self
            .event_started
            .map(|start| now.duration_since(start).as_secs_f64() * 1000.);
        self.commit_started = Some(now);
    }
}
#[derive(Serialize)]
pub struct LayoutBox {
    pub handle: Handle,
    pub source: usize,
    id: Option<String>,
    pub tag: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}
type Identity = (u64, u64, usize);
pub use crate::events::EventSink;
#[derive(Default)]
pub struct Renderer {
    text: BTreeMap<Identity, Rc<RefCell<TextCache>>>,
    controls: BTreeMap<Identity, FocusHandle>,
    inputs: BTreeMap<Identity, Entity<TextInput>>,
    focus_events: BTreeMap<Identity, Vec<Subscription>>,
    styles: StyleCache,
    pub stats: Rc<RefCell<Stats>>,
}
struct FrameInstance {
    handle: Handle,
    attach_to: Option<Attachment>,
    template: Arc<PreparedTemplate>,
    values: Vec<TextValue>,
    cache: Vec<Rc<RefCell<TextCache>>>,
    focus: BTreeMap<usize, FocusHandle>,
    inputs: BTreeMap<usize, Entity<TextInput>>,
    styles: Arc<NativeStyles>,
}
pub struct SceneElement {
    sequence: u64,
    instances: Vec<FrameInstance>,
    roots: Vec<AnyElement>,
    click: EventSink,
    interests: BTreeSet<EventKind>,
    stats: Rc<RefCell<Stats>>,
}

impl Renderer {
    pub fn navigate(
        &self,
        handle: Handle,
        node: usize,
        reverse: bool,
        window: &mut Window,
        cx: &mut App,
    ) {
        if self
            .controls
            .get(&(handle.id, handle.generation, node))
            .is_some_and(|focus| focus.is_focused(window))
        {
            if reverse {
                window.focus_prev(cx);
            } else {
                window.focus_next(cx);
            }
        }
    }
    #[cfg(debug_assertions)]
    pub fn focused(&self, window: &Window) -> Option<(Handle, usize)> {
        self.controls
            .iter()
            .find(|(_, focus)| focus.is_focused(window))
            .map(|((id, generation, node), _)| {
                (
                    Handle {
                        id: *id,
                        generation: *generation,
                    },
                    *node,
                )
            })
    }
    #[cfg(debug_assertions)]
    pub fn painted_inputs(&self, cx: &App) -> serde_json::Value {
        serde_json::json!(self.inputs.iter().map(|((id, generation, node), input)| {
            serde_json::json!({"handle": {"id":id,"generation":generation}, "node":node, "text": input.read(cx).painted_text})
        }).collect::<Vec<_>>())
    }
    #[cfg(debug_assertions)]
    pub fn test_input(
        &self,
        scene: &Scene,
        request: &crate::input::testing::Request,
    ) -> Result<Entity<TextInput>, String> {
        if !scene.instances().any(|instance| instance.handle == request.handle && matches!(instance.template.source.nodes.get(request.node), Some(Node::Element { tag, .. }) if tag == "input")) {
            return Err("Native input test targets a retired or invalid control".into());
        }
        let input = self
            .inputs
            .get(&(request.handle.id, request.handle.generation, request.node))
            .ok_or("Native input is not mounted")?;
        Ok(input.clone())
    }
    /// Validate and prepare actual GPUI styles before the host accepts installation.
    pub fn prepare(&mut self, template: &PreparedTemplate) -> Result<(), String> {
        let styles = styles::prepare(template)?;
        self.styles
            .insert(template.source.id.clone(), Arc::new(styles));
        Ok(())
    }
    pub fn acknowledge(
        &mut self,
        scene: &Scene,
        handle: Handle,
        site: usize,
        edit: u64,
        cx: &mut App,
    ) -> Result<(), String> {
        let instance = scene
            .instances()
            .find(|instance| instance.handle == handle)
            .ok_or("Retired native input owner")?;
        let source = instance
            .template
            .source
            .events
            .get(site)
            .ok_or("Unknown input event")?
            .node;
        let input = self
            .inputs
            .get(&(handle.id, handle.generation, source))
            .ok_or("Native input is not mounted")?;
        input.update(cx, |input, cx| {
            input.acknowledge(edit, &instance.texts[source], cx)
        })
    }
    pub fn element(
        &mut self,
        scene: &Scene,
        click: EventSink,
        window: &mut Window,
        cx: &mut App,
    ) -> SceneElement {
        self.stats.borrow_mut().render_started = Some(Instant::now());
        let mut live_text = BTreeSet::new();
        let mut live_controls = BTreeSet::new();
        let mut live_inputs = BTreeSet::new();
        let order = scene.presentation_order();
        let ranks: BTreeMap<_, _> = order
            .controls
            .iter()
            .enumerate()
            .map(|(index, (handle, source))| {
                ((handle.id, handle.generation, *source), index as isize + 1)
            })
            .collect();
        let records: BTreeMap<_, _> = scene
            .instances()
            .map(|instance| (instance.handle.id, instance))
            .collect();
        let instances = order.instances
            .iter()
            .map(|handle| records[&handle.id])
            .map(|instance| {
                let handle = instance.handle;
                let cache = instance
                    .text_groups
                    .iter()
                    .enumerate()
                    .map(|(group, _)| {
                        let key = (handle.id, handle.generation, group);
                        live_text.insert(key);
                        self.text.entry(key).or_default().clone()
                    })
                    .collect();
                let mut focus = BTreeMap::new();
                let mut inputs = BTreeMap::new();
                for item in &instance.template.presentation.items {
                    if matches!(item.kind, ItemKind::Button | ItemKind::Input) {
                        let key = (handle.id, handle.generation, item.source);
                        live_controls.insert(key);
                        let tracked = self
                            .controls
                            .entry(key)
                            .or_insert_with(|| cx.focus_handle());
                        *tracked = tracked.clone().tab_index(ranks[&key]).tab_stop(true);
                        focus.insert(item.source, tracked.clone());
                        // Subscriptions belong to the retained control identity,
                        // not the temporary GPUI elements constructed for a frame.
                        self.focus_events.entry(key).or_insert_with(|| {
                            let node = item.source;
                            let sink = click.clone();
                            let focused = window.on_focus_in(tracked, cx, move |_, cx| {
                                let event = Emission::new(
                                    handle,
                                    node,
                                    EventKind::Focus,
                                    serde_json::json!({}),
                                );
                                sink(event, cx);
                            });
                            let sink = click.clone();
                            let blurred = window.on_focus_out(tracked, cx, move |_, _, cx| {
                                let event = Emission::new(
                                    handle,
                                    node,
                                    EventKind::Blur,
                                    serde_json::json!({}),
                                );
                                sink(event, cx);
                            });
                            vec![focused, blurred]
                        });
                        if matches!(item.kind, ItemKind::Input) {
                            live_inputs.insert(key);
                            let Node::Element { attributes, .. } = &instance.template.source.nodes[item.source] else {
                                unreachable!()
                            };
                            let site = instance.template.source.events.iter().position(|event| {
                                event.node == item.source && matches!(event.r#type, EventKind::Change)
                            });
                            let sink = click.clone();
                            let on_change: crate::input::ChangeSink = Rc::new(move |value, edit, cx| {
                                if site.is_some() {
                                    let mut event = Emission::new(
                                        handle,
                                        key.2,
                                        EventKind::Change,
                                        serde_json::json!({
                                            "target": {"value": value},
                                            "currentTarget": {"value": value},
                                        }),
                                    );
                                    // The edit number lets reconciliation acknowledge
                                    // this write without replacing a newer native draft.
                                    event.edit = Some(edit);
                                    sink(event, cx);
                                }
                            });
                            let controlled = instance.template.source.slots.iter().any(|slot| {
                                slot.node == item.source && matches!(slot.r#type, SlotKind::Value)
                            });
                            let input = self.inputs.entry(key).or_insert_with(|| {
                                let options = InputOptions {
                                    placeholder: attributes.get("placeholder").cloned().unwrap_or_default(),
                                    label: attributes.get("aria-label").cloned().unwrap_or_default(),
                                    controlled,
                                    expect_ack: site.is_some(),
                                };
                                cx.new(|_| TextInput::new(
                                    tracked.clone(),
                                    &instance.texts[item.source],
                                    options,
                                    on_change,
                                    self.stats.clone(),
                                ))
                            });
                            input.update(cx, |input, cx| {
                                input.set_focus(tracked.clone());
                                input.sync(&instance.texts[item.source], cx);
                            });
                            inputs.insert(item.source, input.clone());
                        }
                    }
                }
                FrameInstance {
                    handle,
                    attach_to: instance.attach_to,
                    template: instance.template.clone(),
                    values: instance.text_groups.clone(),
                    cache,
                    focus,
                    inputs,
                    styles: self.styles[&instance.template.source.id].clone(),
                }
            })
            .collect();
        self.text.retain(|key, _| live_text.contains(key));
        self.controls.retain(|key, _| live_controls.contains(key));
        self.focus_events
            .retain(|key, _| live_controls.contains(key));
        self.inputs.retain(|key, _| live_inputs.contains(key));
        SceneElement {
            sequence: scene.sequence(),
            instances,
            roots: Vec::new(),
            click,
            interests: scene
                .instances()
                .flat_map(|instance| {
                    instance
                        .template
                        .source
                        .events
                        .iter()
                        .map(|event| event.r#type)
                })
                .collect(),
            stats: self.stats.clone(),
        }
    }
}

impl IntoElement for SceneElement {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}
impl Element for SceneElement {
    type RequestLayoutState = ();
    type PrepaintState = ();
    fn id(&self) -> Option<ElementId> {
        Some("desktop-scene".into())
    }
    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }
    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        let mut attached = BTreeMap::<Identity, Vec<Vec<AnyElement>>>::new();
        for instance in self.instances.iter().rev() {
            let plan = &instance.template.presentation;
            let mut elements: Vec<Option<Vec<AnyElement>>> =
                (0..plan.items.len()).map(|_| None).collect();
            for (index, item) in plan.items.iter().enumerate().rev() {
                if matches!(item.kind, ItemKind::Region) {
                    elements[index] = attached
                        .remove(&(instance.handle.id, instance.handle.generation, item.source))
                        .map(|rows| rows.into_iter().rev().flatten().collect());
                    continue;
                }
                let identity = SharedString::from(format!(
                    "{}:{}:{}",
                    instance.handle.id, instance.handle.generation, index
                ));
                let anonymous = matches!(item.kind, ItemKind::Paragraph)
                    && item
                        .parent
                        .is_some_and(|parent| plan.items[parent].source == item.source);
                let focused = instance
                    .focus
                    .get(&item.source)
                    .is_some_and(|focus| focus.is_focused(window));
                let state = if focused { 2 } else { 0 };
                let mut element = div().id(identity.clone());
                if let Node::Element { attributes, .. } =
                    &instance.template.source.nodes[item.source]
                {
                    if let Some(label) = attributes.get("aria-label") {
                        element = element.aria_label(SharedString::from(label.clone()));
                    }
                    if let Some(title) = attributes.get("title") {
                        element = element.aria_description(SharedString::from(title.clone()));
                    }
                }
                *element.style() = if anonymous {
                    StyleRefinement::default().block()
                } else {
                    instance.styles.nodes[item.source][state].clone()
                };
                if let Some(group) = item.group {
                    let value = &instance.values[group];
                    let mut paragraph = Paragraph::new(
                        identity.clone().into(),
                        value.text.clone().into(),
                        value.revision,
                        instance.cache[group].clone(),
                        self.stats.clone(),
                    );
                    for range in value.runs.iter() {
                        let mut chain = Vec::new();
                        let mut current = range
                            .node
                            .and_then(|node| instance.template.source.nodes[node].parent());
                        while let Some(node) = current {
                            if node == item.source {
                                break;
                            }
                            if let Node::Element { tag, .. } = &instance.template.source.nodes[node]
                                && tags::resolve(tag).is_ok_and(|tag| tag.layout == Layout::Inline)
                            {
                                chain.push(instance.styles.nodes[node][0].text.clone());
                            }
                            current = instance.template.source.nodes[node].parent();
                        }
                        chain.reverse();
                        paragraph.fragments.push((range.len, chain));
                    }
                    element = element.child(paragraph);
                    if matches!(item.kind, ItemKind::Button) {
                        let source = item.source;
                        let focus = instance.focus[&source].clone();
                        let label = if let Node::Element { attributes, .. } =
                            &instance.template.source.nodes[source]
                        {
                            attributes
                                .get("aria-label")
                                .cloned()
                                .unwrap_or_else(|| value.text.to_string())
                        } else {
                            value.text.to_string()
                        };
                        element = element
                            .role(Role::Button)
                            .aria_label(SharedString::from(label))
                            .track_focus(&instance.focus[&source])
                            .tab_stop(true)
                            .focus(|style| style)
                            .on_mouse_down(MouseButton::Left, move |_, window, cx| {
                                window.focus(&focus, cx)
                            });
                    } else if let Node::Element { tag, .. } =
                        &instance.template.source.nodes[item.source]
                        && tags::resolve(tag).is_ok_and(|tag| tag.role == Some(tags::Role::Heading))
                    {
                        element = element.role(Role::Heading);
                    }
                }
                if matches!(item.kind, ItemKind::Input) {
                    element = element
                        .track_focus(&instance.focus[&item.source])
                        .focus(|style| style)
                        .child(instance.inputs[&item.source].clone());
                }
                if !anonymous {
                    use EventKind;
                    let handle = instance.handle;
                    let source = item.source;
                    let sink = self.click.clone();
                    element = element.on_click(move |event, _, cx| {
                        cx.stop_propagation();
                        sink(
                            Emission::new(handle, source, EventKind::Click, events::click(event)),
                            cx,
                        );
                    });
                    for (kind, pressed) in [
                        (EventKind::PointerDown, true),
                        (EventKind::PointerUp, false),
                    ] {
                        if !self.interests.contains(&kind) {
                            continue;
                        }
                        let sink = self.click.clone();
                        let focus = instance.focus.get(&source).cloned();
                        if pressed {
                            element = element.on_mouse_down(
                                MouseButton::Left,
                                move |event, window, cx| {
                                    if let Some(focus) = &focus {
                                        window.focus(focus, cx);
                                    }
                                    cx.stop_propagation();
                                    sink(
                                        Emission::new(
                                            handle,
                                            source,
                                            kind,
                                            events::pointer(
                                                event.position,
                                                event.button,
                                                true,
                                                event.modifiers,
                                            ),
                                        ),
                                        cx,
                                    );
                                },
                            );
                        } else {
                            element =
                                element.on_mouse_up(MouseButton::Left, move |event, _, cx| {
                                    cx.stop_propagation();
                                    sink(
                                        Emission::new(
                                            handle,
                                            source,
                                            kind,
                                            events::pointer(
                                                event.position,
                                                event.button,
                                                false,
                                                event.modifiers,
                                            ),
                                        ),
                                        cx,
                                    );
                                });
                        }
                    }
                    if let Some(focus) = instance.focus.get(&source) {
                        let sink = self.click.clone();
                        let focus = focus.clone();
                        let input = instance.inputs.get(&source).cloned();
                        let button = matches!(item.kind, ItemKind::Button);
                        let interested = self.interests.contains(&EventKind::KeyDown);
                        element = element.capture_key_down(move |event, window, cx| {
                            if !focus.is_focused(window) {
                                return;
                            }
                            let target = input.as_ref().map(|input| input.read(cx).event_target());
                            let composing = target
                                .as_ref()
                                .is_some_and(|target| target["isComposing"] == true);
                            let navigation = event.keystroke.key == "tab";
                            let activation = !composing
                                && (event.keystroke.key == "enter"
                                    || button && event.keystroke.key == "space");
                            // Defer only the defaults that Bun can cancel. Native
                            // text editing and IME stay immediate on the UI thread.
                            if navigation || activation {
                                window.prevent_default();
                                cx.stop_propagation();
                            }
                            if interested || navigation || activation {
                                let mut payload = events::keyboard(
                                    &event.keystroke,
                                    event.is_held,
                                    navigation || activation,
                                );
                                payload["isComposing"] = serde_json::json!(composing);
                                if let Some(target) = target {
                                    payload["target"] = target;
                                }
                                let mut emission =
                                    Emission::new(handle, source, EventKind::KeyDown, payload);
                                emission.navigation =
                                    navigation.then_some(event.keystroke.modifiers.shift);
                                sink(emission, cx);
                            }
                        });
                        let sink = self.click.clone();
                        let focus = instance.focus[&source].clone();
                        let interested = self.interests.contains(&EventKind::KeyUp);
                        element = element.capture_key_up(move |event, window, cx| {
                            if !focus.is_focused(window) {
                                return;
                            }
                            let activation = button && event.keystroke.key == "space";
                            if activation {
                                window.prevent_default();
                                cx.stop_propagation();
                            }
                            if interested || activation {
                                sink(
                                    Emission::new(
                                        handle,
                                        source,
                                        EventKind::KeyUp,
                                        events::keyboard(&event.keystroke, false, activation),
                                    ),
                                    cx,
                                );
                            }
                        });
                    }
                }
                for &child in &plan.children[index] {
                    if let Some(children) = elements[child].take() {
                        element = element.children(children);
                    }
                }
                let (tag, id) = match &instance.template.source.nodes[item.source] {
                    Node::Element {
                        tag, attributes, ..
                    } => (tag.clone(), attributes.get("id").cloned()),
                    _ => ("text".into(), None),
                };
                let observed = Observed {
                    pending: Some(element),
                    element: None,
                    hover: (!anonymous)
                        .then(|| instance.styles.nodes[item.source][state + 1].clone()),
                    current_color: if anonymous {
                        [false; 2]
                    } else {
                        [
                            instance.styles.current_color[item.source][state],
                            instance.styles.current_color[item.source][state + 1],
                        ]
                    },
                    handle: instance.handle,
                    source: item.source,
                    tag,
                    id,
                    stats: self.stats.clone(),
                }
                .into_any_element();
                elements[index] = Some(vec![observed]);
            }
            let mut roots = Vec::new();
            for (index, item) in plan.items.iter().enumerate() {
                if item.parent.is_none()
                    && let Some(elements) = elements[index].take()
                {
                    roots.extend(elements);
                }
            }
            if let Some(parent) = instance.attach_to {
                // Accumulate row chunks once, then flatten at the region. This
                // avoids repeatedly copying the already assembled sibling list.
                let key = (parent.handle.id, parent.handle.generation, parent.node);
                attached.entry(key).or_default().push(roots);
            } else {
                self.roots.extend(roots.into_iter().rev());
            }
        }
        self.roots.reverse();
        let layouts = self
            .roots
            .iter_mut()
            .map(|root| root.request_layout(window, cx))
            .collect::<Vec<_>>();
        (
            window.request_layout(
                Style {
                    display: Display::Block,
                    min_size: size(relative(1.).into(), window.viewport_size().height.into()),
                    flex_shrink: 0.,
                    ..Default::default()
                },
                layouts,
                cx,
            ),
            (),
        )
    }
    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        {
            let mut stats = self.stats.borrow_mut();
            stats.width = bounds.size.width.as_f32();
            stats.height = bounds.size.height.as_f32();
            stats.boxes.clear();
            stats.layout_ms = stats
                .render_started
                .map_or(0., |start| start.elapsed().as_secs_f64() * 1000.);
        }
        for root in &mut self.roots {
            root.prepaint(window, cx);
        }
    }
    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        for root in &mut self.roots {
            root.paint(window, cx);
        }
        let mut stats = self.stats.borrow_mut();
        stats.frames += 1;
        stats.sequence = self.sequence;
        let now = Instant::now();
        stats.frame_ms = stats
            .render_started
            .map_or(0., |start| now.duration_since(start).as_secs_f64() * 1000.);
        if let Some(start) = stats.commit_started.take() {
            stats.commit_to_paint_ms = Some(now.duration_since(start).as_secs_f64() * 1000.);
            stats.event_to_paint_ms = stats
                .event_started
                .take()
                .map(|start| now.duration_since(start).as_secs_f64() * 1000.);
        }
    }
}

/// Observe real Taffy bounds for native layout assertions without a second layout path.
struct Observed {
    pending: Option<Stateful<Div>>,
    element: Option<AnyElement>,
    hover: Option<StyleRefinement>,
    current_color: [bool; 2],
    handle: Handle,
    source: usize,
    tag: String,
    id: Option<String>,
    stats: Rc<RefCell<Stats>>,
}
impl IntoElement for Observed {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}
impl Element for Observed {
    type RequestLayoutState = ();
    type PrepaintState = ();
    fn id(&self) -> Option<ElementId> {
        None
    }
    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }
    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        cx: &mut App,
    ) -> (LayoutId, ()) {
        let inherited = window.text_style().color;
        let mut element = self.pending.take().unwrap();
        if self.current_color[0] {
            let color = element.style().text.color.unwrap_or(inherited);
            element.style().border_color = Some(color);
        }
        if let Some(mut hover) = self.hover.take() {
            if self.current_color[1] {
                hover.border_color = Some(hover.text.color.unwrap_or(inherited));
            }
            element = element.hover(move |_| hover);
        }
        let mut element = element.into_any_element();
        let layout = element.request_layout(window, cx);
        self.element = Some(element);
        (layout, ())
    }
    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        self.stats.borrow_mut().boxes.push(LayoutBox {
            handle: self.handle,
            source: self.source,
            id: self.id.clone(),
            tag: self.tag.clone(),
            x: bounds.origin.x.as_f32(),
            y: bounds.origin.y.as_f32(),
            width: bounds.size.width.as_f32(),
            height: bounds.size.height.as_f32(),
        });
        self.element.as_mut().unwrap().prepaint(window, cx);
    }
    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) {
        self.element.as_mut().unwrap().paint(window, cx);
    }
}
