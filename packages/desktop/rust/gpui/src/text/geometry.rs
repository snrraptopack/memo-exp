//! Inline geometry from GPUI's shaped glyphs, not a second text layout engine.
//!
//! Cells retain GPUI's UTF-8 cluster indices and soft-wrap boundaries. Alignment
//! and the paragraph's actual painted origin are applied during prepaint.
use gpui::{Bounds, Pixels, Point, TextAlign, WrappedLineLayout, point, px, size};
use memoized_dom_desktop_host::presentation::TextSource;
use std::{collections::BTreeMap, ops::Range, sync::Arc};

#[derive(Clone, Debug)]
pub struct GlyphCell {
    pub index: usize,
    pub relative: Bounds<Pixels>,
    pub row_width: Pixels,
}

impl GlyphCell {
    pub fn bounds(&self, origin: Point<Pixels>, width: Pixels, align: TextAlign) -> Bounds<Pixels> {
        let shift = match align {
            TextAlign::Left => px(0.),
            TextAlign::Center => (width - self.row_width) / 2.,
            TextAlign::Right => width - self.row_width,
        };
        Bounds::new(
            origin + self.relative.origin + point(shift, px(0.)),
            self.relative.size,
        )
    }
}

#[derive(Clone, PartialEq, Eq)]
pub struct InlineRun {
    pub bytes: Range<usize>,
    /// Outer-to-inner inline elements, including retained component roots.
    pub sources: Arc<[TextSource]>,
}

#[derive(Clone)]
pub struct SourceBounds {
    pub source: TextSource,
    pub bounds: Bounds<Pixels>,
}

/// Append one hard line, using GPUI's existing wrap decisions and glyph advances.
/// Glyph byte indices can be nonmonotonic, as with visual RTL order. Do not use
/// source byte order to infer their physical positions.
pub fn append_cells(
    layout: &WrappedLineLayout,
    byte_start: usize,
    top: Pixels,
    line_height: Pixels,
    cells: &mut Vec<GlyphCell>,
) {
    let glyphs: Vec<_> = layout.runs().iter().flat_map(|run| &run.glyphs).collect();
    let run_starts: Vec<_> = layout
        .runs()
        .iter()
        .scan(0, |offset, run| {
            let start = *offset;
            *offset += run.glyphs.len();
            Some(start)
        })
        .collect();
    let ends = layout
        .wrap_boundaries()
        .iter()
        .map(|boundary| run_starts[boundary.run_ix] + boundary.glyph_ix)
        .chain([glyphs.len()]);
    let mut start = 0;
    let mut row_start_x = px(0.);
    for (row, end) in ends.enumerate() {
        let row_end_x = glyphs
            .get(end)
            .map_or(layout.unwrapped_layout.width, |glyph| glyph.position.x);
        let row_width = row_end_x - row_start_x;
        for index in start..end {
            let glyph = glyphs[index];
            let next_x = glyphs
                .get(index + 1)
                .map_or(row_end_x, |glyph| glyph.position.x);
            let width = next_x - glyph.position.x;
            // Zero-advance combining glyphs contribute to their cluster's cell.
            // Empty wrap boundary glyphs must not acquire a phantom hit area.
            if width <= px(0.) || glyph.index >= layout.len() {
                continue;
            }
            cells.push(GlyphCell {
                index: byte_start + glyph.index,
                relative: Bounds::new(
                    point(
                        glyph.position.x - row_start_x,
                        top + line_height * row as f32,
                    ),
                    size(width, line_height),
                ),
                row_width,
            });
        }
        start = end;
        row_start_x = row_end_x;
    }
}

pub fn source_bounds(
    cells: &[GlyphCell],
    runs: &[InlineRun],
    paragraph: Bounds<Pixels>,
    align: TextAlign,
) -> Vec<SourceBounds> {
    let mut sources = BTreeMap::<(u64, u64, usize), (TextSource, Vec<Bounds<Pixels>>)>::new();
    for cell in cells {
        // Runs are in source order; glyphs need not be. Binary lookup avoids a
        // full scan of all inline fragments for every glyph in a large paragraph.
        let end = runs.partition_point(|run| run.bytes.start <= cell.index);
        let Some(run) = end.checked_sub(1).map(|index| &runs[index]) else {
            continue;
        };
        if !run.bytes.contains(&cell.index) {
            continue;
        }
        let bounds = cell.bounds(paragraph.origin, paragraph.size.width, align);
        for &source in run.sources.iter() {
            let (_, rectangles) = sources
                .entry((source.handle.id, source.handle.generation, source.node))
                .or_insert_with(|| (source, Vec::new()));
            if let Some(previous) = rectangles.last_mut()
                && previous.origin.y == bounds.origin.y
                && previous.size.height == bounds.size.height
                // The tolerance only absorbs floating-point addition error.
                && bounds.left() <= previous.right() + px(0.01)
            {
                *previous = previous.union(&bounds);
            } else {
                rectangles.push(bounds);
            }
        }
    }
    sources
        .into_values()
        .flat_map(|(source, rectangles)| {
            rectangles
                .into_iter()
                .map(move |bounds| SourceBounds { source, bounds })
        })
        .collect()
}

/// Resolve the shaped cluster under a pointer, then its innermost inline source.
/// Cells are in visual row/x order; source runs remain in UTF-8 byte order.
pub fn hit_source<'a>(
    cells: &[GlyphCell],
    runs: &'a [InlineRun],
    paragraph: Bounds<Pixels>,
    align: TextAlign,
    position: Point<Pixels>,
) -> Option<&'a InlineRun> {
    let local = position - paragraph.origin;
    let start = cells.partition_point(|cell| cell.relative.bottom() <= local.y);
    let end = cells.partition_point(|cell| cell.relative.top() <= local.y);
    let row = cells.get(start..end).filter(|row| !row.is_empty())?;
    let shift = match align {
        TextAlign::Left => px(0.),
        TextAlign::Center => (paragraph.size.width - row[0].row_width) / 2.,
        TextAlign::Right => paragraph.size.width - row[0].row_width,
    };
    let x = local.x - shift;
    let end = row.partition_point(|cell| cell.relative.left() <= x);
    let cell = row.get(end.checked_sub(1)?)?;
    if x >= cell.relative.right() {
        return None;
    }
    let end = runs.partition_point(|run| run.bytes.start <= cell.index);
    let run = runs.get(end.checked_sub(1)?)?;
    run.bytes.contains(&cell.index).then_some(run)
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::{FontId, GlyphId, LineLayout, ShapedGlyph, ShapedRun, WrapBoundary};
    use memoized_dom_desktop_host::Handle;

    fn layout(indices: &[usize], boundary: Option<usize>, len: usize) -> WrappedLineLayout {
        WrappedLineLayout {
            unwrapped_layout: Arc::new(LineLayout {
                font_size: px(16.),
                width: px(indices.len() as f32 * 10.),
                len,
                runs: vec![ShapedRun {
                    font_id: FontId(0),
                    glyphs: indices
                        .iter()
                        .enumerate()
                        .map(|(index, &byte)| ShapedGlyph {
                            id: GlyphId(index as u32),
                            position: point(px(index as f32 * 10.), px(0.)),
                            index: byte,
                            is_emoji: false,
                        })
                        .collect(),
                }],
                ..Default::default()
            }),
            wrap_boundaries: boundary
                .into_iter()
                .map(|glyph_ix| WrapBoundary {
                    run_ix: 0,
                    glyph_ix,
                })
                .collect(),
            wrap_width: boundary.map(|index| px(index as f32 * 10.)),
        }
    }

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
    fn wrapping_alignment_and_utf8_indices_follow_the_shaped_layout() {
        let mut cells = Vec::new();
        append_cells(
            &layout(&[0, 1, 5, 6, 7, 8], Some(3), 9),
            4,
            px(0.),
            px(20.),
            &mut cells,
        );
        assert_eq!(
            cells.iter().map(|cell| cell.index).collect::<Vec<_>>(),
            [4, 5, 9, 10, 11, 12]
        );
        let origin = point(px(5.), px(7.));
        assert_eq!(
            cells[3].bounds(origin, px(100.), TextAlign::Center).origin,
            point(px(40.), px(27.))
        );
        assert_eq!(
            cells[3].bounds(origin, px(100.), TextAlign::Right).origin,
            point(px(75.), px(27.))
        );
        let runs = [InlineRun {
            bytes: 9..12,
            sources: Arc::from([source(1), source(2)]),
        }];
        let bounds = source_bounds(
            &cells,
            &runs,
            Bounds::new(origin, size(px(100.), px(40.))),
            TextAlign::Left,
        );
        assert_eq!(bounds.len(), 4);
        assert_eq!(bounds[0].bounds.origin, point(px(25.), px(7.)));
        assert_eq!(bounds[1].bounds.size.width, px(20.));
        assert_eq!(bounds[2].source, source(2));
    }

    #[test]
    fn visual_glyph_order_does_not_assume_monotonic_source_indices() {
        let mut cells = Vec::new();
        append_cells(&layout(&[4, 2, 0], None, 6), 0, px(0.), px(20.), &mut cells);
        let runs = [InlineRun {
            bytes: 0..2,
            sources: Arc::from([source(1)]),
        }];
        let bounds = source_bounds(
            &cells,
            &runs,
            Bounds::new(point(px(0.), px(0.)), size(px(30.), px(20.))),
            TextAlign::Left,
        );
        assert_eq!(bounds.len(), 1);
        assert_eq!(bounds[0].bounds.origin.x, px(20.));
        assert_eq!(bounds[0].bounds.size.width, px(10.));
        let paragraph = Bounds::new(point(px(0.), px(0.)), size(px(30.), px(20.)));
        assert_eq!(
            hit_source(
                &cells,
                &runs,
                paragraph,
                TextAlign::Left,
                point(px(25.), px(10.))
            )
            .unwrap()
            .sources[0],
            source(1)
        );
        assert!(
            hit_source(
                &cells,
                &runs,
                paragraph,
                TextAlign::Left,
                point(px(5.), px(10.))
            )
            .is_none()
        );
    }

    #[test]
    fn aligned_wrapped_hit_tests_exclude_blank_space_and_line_gaps() {
        let mut cells = Vec::new();
        append_cells(
            &layout(&[0, 1, 5, 6, 7, 8], Some(3), 9),
            0,
            px(0.),
            px(20.),
            &mut cells,
        );
        let runs = [InlineRun {
            bytes: 6..8,
            sources: Arc::from([source(1), source(2)]),
        }];
        let paragraph = Bounds::new(point(px(5.), px(7.)), size(px(100.), px(40.)));
        let hit = hit_source(
            &cells,
            &runs,
            paragraph,
            TextAlign::Center,
            point(px(45.), px(35.)),
        )
        .unwrap();
        assert_eq!(hit.sources.last(), Some(&source(2)));
        assert!(
            hit_source(
                &cells,
                &runs,
                paragraph,
                TextAlign::Center,
                point(px(10.), px(35.))
            )
            .is_none()
        );
        assert!(
            hit_source(
                &cells,
                &runs,
                paragraph,
                TextAlign::Center,
                point(px(90.), px(35.))
            )
            .is_none()
        );
        assert!(
            hit_source(
                &cells,
                &runs,
                paragraph,
                TextAlign::Center,
                point(px(45.), px(55.))
            )
            .is_none()
        );
    }
}
