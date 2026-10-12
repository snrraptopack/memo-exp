//! Pointer admission against the painted frame, before any platform event fires.
use crate::renderer::Stats;
use gpui::{Bounds, Pixels, Point, point, px, size};
use memoized_dom_desktop_host::Handle;

pub const STALE_GEOMETRY: &str = "Test pointer geometry is stale";

pub fn position(
    stats: &Stats,
    handle: Handle,
    node: usize,
    viewport: Bounds<Pixels>,
    expected_frame: Option<u64>,
    accepted_sequence: u64,
) -> Result<Point<Pixels>, String> {
    if let Some(frame) = expected_frame
        && (frame != stats.frames || stats.sequence != accepted_sequence)
    {
        // A stale rejection is safe to retry: callers have not reached the
        // dispatch path, so it cannot have emitted a press, release, or click.
        return Err(STALE_GEOMETRY.into());
    }
    let mut painted = false;
    for bounds in stats.boxes.iter().chain(&stats.inline_ranges) {
        if bounds.handle != handle || bounds.source != node {
            continue;
        }
        painted = true;
        let visible = Bounds::new(
            point(px(bounds.x), px(bounds.y)),
            size(px(bounds.width), px(bounds.height)),
        )
        .intersect(&viewport);
        if visible.size.width > px(0.) && visible.size.height > px(0.) {
            // Wrapped sources can have an offscreen first line and visible
            // later lines. Large/partially clipped boxes also need a point in
            // their visible intersection, rather than their full-box center.
            return Ok(visible.center());
        }
    }
    Err(if painted {
        "Test pointer target is outside the viewport"
    } else {
        "Target was not painted"
    }
    .into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::renderer::LayoutBox;

    fn handle() -> Handle {
        Handle {
            id: 7,
            generation: 2,
        }
    }

    fn bounds(x: f32, y: f32, width: f32, height: f32) -> Bounds<Pixels> {
        Bounds::new(point(px(x), px(y)), size(px(width), px(height)))
    }

    fn measured(rect: Bounds<Pixels>) -> LayoutBox {
        LayoutBox::new(handle(), 3, "span".into(), None, rect)
    }

    fn stats() -> Stats {
        let mut stats = Stats::default();
        stats.frames = 12;
        stats.sequence = 5;
        stats
    }

    #[test]
    fn wrapped_sources_choose_a_visible_line_in_the_actual_viewport() {
        let mut stats = stats();
        stats.inline_ranges = vec![
            measured(bounds(20., -20., 60., 20.)),
            measured(bounds(20., 40., 60., 20.)),
        ];
        let viewport = bounds(10., 30., 100., 100.);
        assert_eq!(
            position(&stats, handle(), 3, viewport, Some(12), 5).unwrap(),
            point(px(50.), px(50.))
        );
    }

    #[test]
    fn partially_clipped_and_large_boxes_use_their_visible_intersection() {
        let mut stats = stats();
        let viewport = bounds(0., 0., 100., 100.);
        stats.boxes = vec![measured(bounds(-60., -20., 100., 50.))];
        assert_eq!(
            position(&stats, handle(), 3, viewport, Some(12), 5).unwrap(),
            point(px(20.), px(15.))
        );
        stats.boxes = vec![measured(bounds(0., -1900., 100., 3000.))];
        assert_eq!(
            position(&stats, handle(), 3, viewport, Some(12), 5).unwrap(),
            point(px(50.), px(50.))
        );
    }

    #[test]
    fn stale_frames_and_unpainted_commits_reject_before_target_selection() {
        let stats = stats();
        let viewport = bounds(0., 0., 100., 100.);
        assert_eq!(
            position(&stats, handle(), 3, viewport, Some(11), 5).unwrap_err(),
            STALE_GEOMETRY
        );
        assert_eq!(
            position(&stats, handle(), 3, viewport, Some(12), 6).unwrap_err(),
            STALE_GEOMETRY
        );
        assert_eq!(
            position(&stats, handle(), 3, viewport, Some(12), 5).unwrap_err(),
            "Target was not painted"
        );
    }

    #[test]
    fn offscreen_empty_and_retired_sources_do_not_invent_pointer_positions() {
        let mut stats = stats();
        let viewport = bounds(0., 0., 100., 100.);
        stats.inline_ranges = vec![measured(bounds(10., -50., 50., 20.))];
        assert_eq!(
            position(&stats, handle(), 3, viewport, Some(12), 5).unwrap_err(),
            "Test pointer target is outside the viewport"
        );
        stats.inline_ranges = vec![measured(bounds(10., 10., 0., 20.))];
        assert!(position(&stats, handle(), 3, viewport, Some(12), 5).is_err());
        let retired = Handle {
            id: 7,
            generation: 1,
        };
        assert_eq!(
            position(&stats, retired, 3, viewport, Some(12), 5).unwrap_err(),
            "Target was not painted"
        );
    }
}
