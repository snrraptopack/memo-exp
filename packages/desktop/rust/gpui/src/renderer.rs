//! GPUI adapter for prepared native flow; GPUI owns styling and Taffy layout.
use crate::{
    input::{InputOptions, TextInput},
    styles::{self, NativeStyles, StyleCache},
    text::{Paragraph, TextCache},
};
use gpui::{prelude::*, *};
use memoized_dom_desktop_host::{
    Handle, Scene,
    presentation::{ItemKind, TextValue},
    tags::{self, Layout},
    template::{Node, PreparedTemplate},
};
use serde::Serialize;
use std::{
    cell::RefCell,
    collections::{BTreeMap, BTreeSet},
    rc::Rc,
    sync::Arc,
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
}
#[derive(Serialize)]
pub struct LayoutBox {
    handle: Handle,
    source: usize,
    id: Option<String>,
    tag: String,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}
type Identity = (u64, u64, usize);
pub type EventSink = Rc<dyn Fn(Handle, usize, Option<serde_json::Value>, Option<u64>, &mut App)>;
#[derive(Default)]
pub struct Renderer {
    text: BTreeMap<Identity, Rc<RefCell<TextCache>>>,
    controls: BTreeMap<Identity, FocusHandle>,
    inputs: BTreeMap<Identity, Entity<TextInput>>,
    styles: StyleCache,
    pub stats: Rc<RefCell<Stats>>,
}
struct FrameInstance {
    handle: Handle,
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
    stats: Rc<RefCell<Stats>>,
}

impl Renderer {
    #[cfg(debug_assertions)]
    pub fn test_input(
        &mut self,
        scene: &Scene,
        request: &crate::input::testing::Request,
        window: &mut Window,
        cx: &mut App,
    ) -> Result<(), String> {
        if !scene.instances().any(|instance| instance.handle == request.handle && matches!(instance.template.source.nodes.get(request.node), Some(Node::Element { tag, .. }) if tag == "input")) {
            return Err("Native input test targets a retired or invalid control".into());
        }
        let input = self
            .inputs
            .get(&(request.handle.id, request.handle.generation, request.node))
            .ok_or("Native input is not mounted")?;
        input.update(cx, |input, cx| request.apply(input, window, cx))
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
    pub fn element(&mut self, scene: &Scene, click: EventSink, cx: &mut App) -> SceneElement {
        let mut live_text = BTreeSet::new();
        let mut live_controls = BTreeSet::new();
        let mut live_inputs = BTreeSet::new();
        let mut tab_index = 0;
        let instances = scene
            .instances()
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
                        tab_index += 1;
                        live_controls.insert(key);
                        let tracked = self
                            .controls
                            .entry(key)
                            .or_insert_with(|| cx.focus_handle());
                        *tracked = tracked.clone().tab_index(tab_index).tab_stop(true);
                        focus.insert(item.source, tracked.clone());
                        if matches!(item.kind, ItemKind::Input) {
                            live_inputs.insert(key);
                            let Node::Element { attributes, .. } = &instance.template.source.nodes[item.source] else { unreachable!() };
                            let site = instance.template.source.events.iter().position(|event| event.node == item.source && matches!(event.r#type, memoized_dom_desktop_host::template::EventKind::Change));
                            let sink = click.clone();
                            let on_change: crate::input::ChangeSink = Rc::new(move |value, edit, cx| {
                                if let Some(site) = site { sink(handle, site, Some(serde_json::json!({"target":{"value":value}, "currentTarget":{"value":value}})), Some(edit), cx); }
                            });
                            let controlled = instance.template.source.slots.iter().any(|slot| slot.node == item.source && matches!(slot.r#type, memoized_dom_desktop_host::template::SlotKind::Value));
                            let input = self.inputs.entry(key).or_insert_with(|| cx.new(|_| TextInput::new(
                                tracked.clone(), &instance.texts[item.source], InputOptions { placeholder: attributes.get("placeholder").cloned().unwrap_or_default(), label: attributes.get("aria-label").cloned().unwrap_or_default(), controlled, expect_ack: site.is_some() }, on_change, self.stats.clone(),
                            )));
                            input.update(cx, |input, cx| { input.set_focus(tracked.clone()); input.sync(&instance.texts[item.source], cx); });
                            inputs.insert(item.source, input.clone());
                        }
                    }
                }
                FrameInstance {
                    handle,
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
        self.inputs.retain(|key, _| live_inputs.contains(key));
        SceneElement {
            sequence: scene.sequence(),
            instances,
            roots: Vec::new(),
            click,
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
        for instance in &self.instances {
            let plan = &instance.template.presentation;
            let mut elements: Vec<Option<AnyElement>> =
                (0..plan.items.len()).map(|_| None).collect();
            for (index, item) in plan.items.iter().enumerate().rev() {
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
                        let handle = instance.handle;
                        let source = item.source;
                        let site = instance
                            .template
                            .source
                            .events
                            .iter()
                            .position(|event| event.node == source);
                        let sink = self.click.clone();
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
                            .on_click(move |_, _, cx| {
                                if let Some(site) = site {
                                    sink(handle, site, None, None, cx);
                                }
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
                for &child in &plan.children[index] {
                    element = element.child(elements[child].take().unwrap());
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
                elements[index] = Some(observed);
            }
            for (index, item) in plan.items.iter().enumerate() {
                if item.parent.is_none() {
                    self.roots.push(elements[index].take().unwrap());
                }
            }
        }
        let layouts = self
            .roots
            .iter_mut()
            .map(|root| root.request_layout(window, cx))
            .collect::<Vec<_>>();
        (
            window.request_layout(
                Style {
                    display: Display::Block,
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
