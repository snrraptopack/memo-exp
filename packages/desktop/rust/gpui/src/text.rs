//! Paragraph shaping belongs to persistent native state, not transient elements.
use crate::renderer::Stats;
use gpui::{
    App, AvailableSpace, Bounds, Element, ElementId, GlobalElementId, InspectorElementId,
    IntoElement, LayoutId, Pixels, SharedString, Size, TextRun, TextStyle, TextStyleRefinement,
    WhiteSpace, Window, WrappedLine, px,
};
use std::{cell::RefCell, rc::Rc};

#[derive(PartialEq)]
struct Key {
    revision: u64,
    style: TextStyle,
    font_size: Pixels,
    line_height: Pixels,
    width: Option<Pixels>,
    scale: f32,
    runs: Vec<TextRun>,
}
struct Shaped {
    key: Key,
    lines: Vec<WrappedLine>,
    size: Size<Pixels>,
}
#[derive(Default)]
pub struct TextCache {
    shaped: Vec<Shaped>,
    active: Option<usize>,
}

pub struct Paragraph {
    pub id: ElementId,
    pub text: SharedString,
    pub revision: u64,
    pub cache: Rc<RefCell<TextCache>>,
    pub stats: Rc<RefCell<Stats>>,
    pub fragments: Vec<(usize, Vec<TextStyleRefinement>)>,
    bounds: Option<Bounds<Pixels>>,
}
impl Paragraph {
    pub fn new(
        id: ElementId,
        text: SharedString,
        revision: u64,
        cache: Rc<RefCell<TextCache>>,
        stats: Rc<RefCell<Stats>>,
    ) -> Self {
        Self {
            id,
            text,
            revision,
            cache,
            stats,
            fragments: Vec::new(),
            bounds: None,
        }
    }
}
impl IntoElement for Paragraph {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}
impl Element for Paragraph {
    type RequestLayoutState = ();
    type PrepaintState = ();
    fn id(&self) -> Option<ElementId> {
        Some(self.id.clone())
    }
    fn source_location(&self) -> Option<&'static std::panic::Location<'static>> {
        None
    }
    fn a11y_role(&self) -> Option<gpui::Role> {
        Some(gpui::Role::Label)
    }
    fn write_a11y_info(&self, node: &mut gpui::accesskit::Node) {
        node.set_value(self.text.to_string());
    }
    fn request_layout(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        window: &mut Window,
        _: &mut App,
    ) -> (LayoutId, ()) {
        let text = self.text.clone();
        let revision = self.revision;
        let cache = self.cache.clone();
        let stats = self.stats.clone();
        let style = window.text_style();
        let runs: Vec<TextRun> = self
            .fragments
            .iter()
            .map(|(len, refinements)| {
                let mut effective = style.clone();
                for refinement in refinements {
                    crate::styles::apply_text(&mut effective, refinement);
                }
                effective.to_run(*len)
            })
            .collect();
        let runs = if runs.is_empty() {
            vec![style.to_run(text.len())]
        } else {
            runs
        };
        let font_size = style.font_size.to_pixels(window.rem_size());
        let line_height = window.pixel_snap(style.line_height_in_pixels(window.rem_size()));
        let layout = window.request_measured_layout(
            Default::default(),
            move |known, available, window, _cx| {
                let width = if style.white_space == WhiteSpace::Normal {
                    known.width.or(match available.width {
                        AvailableSpace::Definite(width) => Some(width),
                        _ => None,
                    })
                } else {
                    None
                };
                let key = Key {
                    revision,
                    style: style.clone(),
                    font_size,
                    line_height,
                    width,
                    scale: window.scale_factor(),
                    runs: runs.clone(),
                };
                let mut cache = cache.borrow_mut();
                if let Some(index) = cache.shaped.iter().position(|shaped| shaped.key == key) {
                    cache.active = Some(index);
                    return cache.shaped[index].size;
                }
                let lines = match window.text_system().shape_text(
                    text.clone(),
                    font_size,
                    &runs,
                    width,
                    style.line_clamp,
                ) {
                    Ok(lines) => lines.into_vec(),
                    Err(error) => {
                        stats.borrow_mut().error = Some(error.to_string());
                        cache.active = None;
                        return Size::default();
                    }
                };
                let mut measured = Size {
                    width: px(0.),
                    height: px(0.),
                };
                for line in &lines {
                    let size = line.size(line_height);
                    measured.width = measured.width.max(size.width).ceil();
                    measured.height += size.height;
                }
                stats.borrow_mut().shaping += 1;
                // Keep the intrinsic and constrained probes for this content,
                // bounded so resize/hover cannot grow the cache indefinitely.
                cache
                    .shaped
                    .retain(|shaped| shaped.key.revision == revision);
                if cache.shaped.len() == 4 {
                    cache.shaped.remove(0);
                }
                cache.shaped.push(Shaped {
                    key,
                    lines,
                    size: measured,
                });
                cache.active = Some(cache.shaped.len() - 1);
                measured
            },
        );
        (layout, ())
    }
    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        _: &mut Window,
        _: &mut App,
    ) {
        self.bounds = Some(bounds);
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
        let Some(bounds) = self.bounds else {
            return;
        };
        let cache = self.cache.borrow();
        let Some(shaped) = cache.active.and_then(|index| cache.shaped.get(index)) else {
            return;
        };
        let mut origin = bounds.origin;
        for line in &shaped.lines {
            if let Err(error) = line.paint(
                origin,
                shaped.key.line_height,
                shaped.key.style.text_align,
                Some(bounds),
                window,
                cx,
            ) {
                self.stats.borrow_mut().error = Some(error.to_string());
            }
            origin.y += line.size(shaped.key.line_height).height;
        }
    }
}
