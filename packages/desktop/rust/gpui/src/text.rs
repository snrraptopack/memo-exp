//! Paragraph shaping belongs to persistent native state, not transient elements.
mod cursor;
mod geometry;
mod interaction;
pub use geometry::InlineRun;
pub use interaction::InlineInput;

use crate::renderer::{LayoutBox, Stats};
use gpui::{
    App, AvailableSpace, Bounds, CursorStyle, Element, ElementId, GlobalElementId, Hitbox,
    HitboxBehavior, InspectorElementId, IntoElement, LayoutId, Pixels, SharedString, Size, TextRun,
    TextStyle, TextStyleRefinement, WhiteSpace, Window, WrappedLine, px,
};
use memoized_dom_desktop_host::presentation::TextSource;
use std::{cell::RefCell, collections::BTreeMap, rc::Rc, sync::Arc};

/// Metadata for an authored inline source, shared by geometry and interaction.
pub struct InlineSource {
    pub tag: String,
    pub id: Option<String>,
    /// All ancestors of the hit glyph are hovered. The accepted hover cascade
    /// already includes the normal cursor declaration when it has no override.
    pub cursor: Option<CursorStyle>,
}

#[derive(serde::Serialize)]
pub struct InlineCursor {
    pub source: TextSource,
    pub style: CursorStyle,
}

#[derive(PartialEq)]
struct Key {
    revision: u64,
    // An anonymous group can disappear and return between two painted frames.
    // Its source identity and initial revision may match an older cached group.
    text: SharedString,
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
    /// Relative glyph geometry is prepared only when an inline source needs it.
    /// Retain it with shaping so unchanged frames do not walk glyphs again.
    cells: Option<Arc<[geometry::GlyphCell]>>,
    regions: Option<InlineRegions>,
}

struct InlineRegions {
    runs: Vec<InlineRun>,
    width: Pixels,
    bounds: Vec<geometry::SourceBounds>,
}
#[derive(Default)]
pub struct TextCache {
    shaped: Vec<Shaped>,
    active: Option<usize>,
    pressed: Option<Rc<RefCell<Option<interaction::Pressed>>>>,
    /// Presentation state follows measured source ancestry, not application state.
    hovered: Arc<[TextSource]>,
    bounds: Option<Bounds<Pixels>>,
}

/// Both variants come from the accepted CSS cascade. Source identity decides
/// which refinement participates in the existing outer-to-inner text chain.
pub struct InlineStyle {
    pub source: TextSource,
    pub normal: TextStyleRefinement,
    pub hover: TextStyleRefinement,
}

impl InlineStyle {
    fn effective(&self, hovered: &[TextSource]) -> &TextStyleRefinement {
        if hovered.contains(&self.source) {
            &self.hover
        } else {
            &self.normal
        }
    }
}

pub struct Paragraph {
    pub id: ElementId,
    pub text: SharedString,
    pub revision: u64,
    pub cache: Rc<RefCell<TextCache>>,
    pub stats: Rc<RefCell<Stats>>,
    pub fragments: Vec<(usize, Vec<InlineStyle>)>,
    pub inline_runs: Vec<InlineRun>,
    pub inline_sources: BTreeMap<(u64, u64, usize), InlineSource>,
    pub input: Option<InlineInput>,
    hover: bool,
    painted_hover: Arc<[TextSource]>,
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
            inline_runs: Vec::new(),
            inline_sources: BTreeMap::new(),
            input: None,
            hover: false,
            painted_hover: Arc::from([]),
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
    type PrepaintState = Option<Hitbox>;
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
        self.hover = self
            .inline_sources
            .values()
            .any(|source| source.cursor.is_some())
            || self.fragments.iter().any(|(_, chain)| {
                chain
                    .iter()
                    .any(|refinement| refinement.normal != refinement.hover)
            });
        if !self.hover {
            // Accepted restyling can remove the final hover rule while the text
            // group survives. Retire presentation state with that capability.
            self.cache.borrow_mut().hovered = Arc::from([]);
        }
        let hovered = self.cache.borrow().hovered.clone();
        self.painted_hover = hovered.clone();
        let runs: Vec<TextRun> = self
            .fragments
            .iter()
            .map(|(len, refinements)| {
                let mut effective = style.clone();
                for refinement in refinements {
                    crate::styles::apply_text(&mut effective, refinement.effective(&hovered));
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
                    text: text.clone(),
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
                    cells: None,
                    regions: None,
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
        window: &mut Window,
        cx: &mut App,
    ) -> Self::PrepaintState {
        self.bounds = Some(bounds);
        if self.inline_runs.is_empty() {
            return None;
        }
        let mut cache = self.cache.borrow_mut();
        cache.bounds = Some(bounds);
        let Some(index) = cache.active else {
            return None;
        };
        let shaped = &mut cache.shaped[index];
        let cells = shaped.cells.get_or_insert_with(|| {
            let mut cells = Vec::new();
            let mut byte_start = 0;
            let mut top = px(0.);
            for line in &shaped.lines {
                geometry::append_cells(line, byte_start, top, shaped.key.line_height, &mut cells);
                byte_start += line.len() + 1;
                top += line.size(shaped.key.line_height).height;
            }
            cells.into()
        });
        let width = if shaped.key.style.text_align == gpui::TextAlign::Left {
            px(0.)
        } else {
            bounds.size.width
        };
        if !shaped
            .regions
            .as_ref()
            .is_some_and(|regions| regions.width == width && regions.runs == self.inline_runs)
        {
            shaped.regions = Some(InlineRegions {
                runs: self.inline_runs.clone(),
                width,
                bounds: geometry::source_bounds(
                    cells,
                    &self.inline_runs,
                    Bounds::new(Default::default(), bounds.size),
                    shaped.key.style.text_align,
                ),
            });
            self.stats.borrow_mut().inline_geometry += 1;
        }
        let mut stats = self.stats.borrow_mut();
        for range in &shaped.regions.as_ref().unwrap().bounds {
            let TextSource { handle, node } = range.source;
            let source = &self.inline_sources[&(handle.id, handle.generation, node)];
            stats.inline_ranges.push(LayoutBox::new(
                handle,
                node,
                source.tag.clone(),
                source.id.clone(),
                Bounds::new(bounds.origin + range.bounds.origin, range.bounds.size),
            ));
        }
        drop(stats);
        if self.hover {
            interaction::retire_displaced_hover(&mut cache, &self.inline_runs, window, cx);
        }
        (self.hover || self.input.is_some())
            .then(|| window.insert_hitbox(bounds, HitboxBehavior::Normal))
    }
    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        _: Bounds<Pixels>,
        _: &mut (),
        hitbox: &mut Self::PrepaintState,
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
        if self.hover {
            self.stats
                .borrow_mut()
                .inline_hovered
                .extend(self.painted_hover.iter().copied());
        }
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
        if let Some(hitbox) = hitbox.as_ref()
            && hitbox.is_hovered(window)
            && let Some(run) =
                interaction::hit(&cache, &self.inline_runs, bounds, window.mouse_position())
            && let Some(request) = cursor::resolve(&run.sources, &self.inline_sources)
        {
            window.set_cursor_style(request.style, hitbox);
            self.stats.borrow_mut().inline_cursor = Some(request);
        }
        drop(cache);
        if self.hover
            && let Some(hitbox) = hitbox.clone()
        {
            interaction::install_hover(
                self.cache.clone(),
                self.inline_runs.clone(),
                bounds,
                hitbox,
                window,
                cx,
            );
        }
        if let Some(hitbox) = hitbox.clone()
            && let Some(input) = self.input.take()
        {
            interaction::install(
                input,
                self.cache.clone(),
                std::mem::take(&mut self.inline_runs),
                bounds,
                hitbox,
                window,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{FontWeight, rgb};
    use memoized_dom_desktop_host::Handle;

    fn source(node: usize) -> TextSource {
        TextSource {
            handle: Handle {
                id: 7,
                generation: 2,
            },
            node,
        }
    }

    #[test]
    fn nested_hover_refinements_keep_authored_inheritance_and_normal_overrides() {
        let parent = InlineStyle {
            source: source(1),
            normal: TextStyleRefinement {
                color: Some(rgb(0x111111).into()),
                font_weight: Some(FontWeight(400.)),
                ..Default::default()
            },
            hover: TextStyleRefinement {
                color: Some(rgb(0x225588).into()),
                font_weight: Some(FontWeight(900.)),
                ..Default::default()
            },
        };
        let child = InlineStyle {
            source: source(2),
            normal: TextStyleRefinement {
                font_weight: Some(FontWeight(700.)),
                ..Default::default()
            },
            hover: TextStyleRefinement {
                font_weight: Some(FontWeight(400.)),
                ..Default::default()
            },
        };
        let resolve = |hovered: &[TextSource]| {
            let mut effective = TextStyle::default();
            for inline in [&parent, &child] {
                crate::styles::apply_text(&mut effective, inline.effective(hovered));
            }
            effective
        };
        let normal = resolve(&[]);
        assert_eq!(normal.color, rgb(0x111111).into());
        assert_eq!(normal.font_weight, FontWeight(700.));

        let nested = resolve(&[parent.source, child.source]);
        assert_eq!(nested.color, rgb(0x225588).into());
        assert_eq!(nested.font_weight, FontWeight(400.));

        let parent_only = resolve(&[parent.source]);
        assert_eq!(parent_only.color, nested.color);
        assert_eq!(parent_only.font_weight, normal.font_weight);
        assert_eq!(resolve(&[]), normal);
    }

    #[test]
    fn hover_does_not_follow_a_reused_owner_id_with_a_new_generation() {
        let inline = InlineStyle {
            source: source(1),
            normal: TextStyleRefinement::default(),
            hover: TextStyleRefinement {
                font_weight: Some(FontWeight(900.)),
                ..Default::default()
            },
        };
        let retired = TextSource {
            handle: Handle {
                id: 7,
                generation: 1,
            },
            node: 1,
        };
        assert_eq!(inline.effective(&[retired]), &inline.normal);
        assert_eq!(inline.effective(&[inline.source]), &inline.hover);
    }
}
