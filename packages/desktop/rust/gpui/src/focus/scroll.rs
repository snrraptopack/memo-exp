//! Center focus targets using completed Taffy geometry in the root scrollport.
use crate::renderer::Stats;
use gpui::{Bounds, Pixels, Point, px};
use memoized_dom_desktop_host::bridge::FocusRequest;
use memoized_dom_desktop_host::presentation::TextSource;

/// None means the accepted scene/scrollport has not completed a frame yet.
pub fn plan(
    stats: &Stats,
    sequence: u64,
    command: FocusRequest,
    viewport: Bounds<Pixels>,
    offset: Point<Pixels>,
    max_offset: Point<Pixels>,
) -> Result<Option<Point<Pixels>>, String> {
    if let Some(error) = &stats.error {
        return Err(format!("Native focus layout unavailable: {error}"));
    }
    if stats.frames == 0
        || stats.focused
            != Some(TextSource {
                handle: command.handle,
                node: command.node,
            })
        || stats.sequence != sequence
        || stats.scroll_offset != offset
        || viewport.size.height <= px(0.)
    {
        return Ok(None);
    }
    let target = stats
        .boxes
        .iter()
        .find(|region| region.handle == command.handle && region.source == command.node)
        .ok_or("Focus control has no completed native layout bounds")?;

    // Source coordinates already include the current scroll offset. Adjust the
    // retained offset by the distance between target and scrollport centers.
    // The HTML focus algorithm uses center alignment. GPUI's root currently
    // scrolls vertically; horizontal/nested scrollports remain separate gaps.
    let target_center = target.y + target.height / 2.;
    let viewport_center = viewport.origin.y.as_f32() + viewport.size.height.as_f32() / 2.;
    let y = (offset.y.as_f32() + viewport_center - target_center)
        .clamp(-max_offset.y.as_f32().max(0.), 0.);
    Ok(Some(Point {
        x: offset.x,
        y: px(y),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::renderer::LayoutBox;
    use gpui::{point, size};
    use memoized_dom_desktop_host::Handle;

    fn fixture(y: f32) -> (Stats, FocusRequest) {
        let command = FocusRequest {
            handle: Handle {
                id: 1,
                generation: 2,
            },
            node: 3,
            focused: true,
            prevent_scroll: false,
        };
        let mut stats = Stats::default();
        stats.frames = 2;
        stats.sequence = 4;
        stats.focused = Some(TextSource {
            handle: command.handle,
            node: command.node,
        });
        stats.boxes.push(LayoutBox::new(
            command.handle,
            command.node,
            "input".into(),
            None,
            Bounds::new(point(px(10.), px(y)), size(px(200.), px(40.))),
        ));
        (stats, command)
    }

    #[test]
    fn centers_measured_sources_and_preserves_horizontal_offset() {
        let viewport = Bounds::new(point(px(0.), px(50.)), size(px(800.), px(600.)));
        for (target_y, current_y, expected_y) in [
            (1000., 0., -670.),
            (-100., -500., -70.),
            (330., -500., -500.),
        ] {
            let (mut stats, command) = fixture(target_y);
            stats.scroll_offset = point(px(-12.), px(current_y));
            let result = plan(
                &stats,
                4,
                command,
                viewport,
                point(px(-12.), px(current_y)),
                point(px(100.), px(2000.)),
            )
            .unwrap()
            .unwrap();
            assert_eq!(result, point(px(-12.), px(expected_y)));
        }
    }

    #[test]
    fn clamps_to_content_edges_including_zero_scroll_range() {
        let viewport = Bounds::new(point(px(0.), px(0.)), size(px(800.), px(600.)));
        for (target_y, max_y, expected_y) in
            [(-100., 1000., 0.), (2000., 1000., -1000.), (1000., 0., 0.)]
        {
            let (stats, command) = fixture(target_y);
            let result = plan(
                &stats,
                4,
                command,
                viewport,
                point(px(0.), px(0.)),
                point(px(0.), px(max_y)),
            )
            .unwrap()
            .unwrap();
            assert_eq!(result.y, px(expected_y));
        }
    }

    #[test]
    fn waits_for_current_paint_and_never_borrows_another_source_generation() {
        let (mut stats, mut command) = fixture(1000.);
        let viewport = Bounds::new(point(px(0.), px(0.)), size(px(800.), px(600.)));
        let offset = point(px(0.), px(0.));
        let max = point(px(0.), px(2000.));
        assert!(
            plan(&stats, 5, command, viewport, offset, max)
                .unwrap()
                .is_none()
        );
        stats.frames = 0;
        assert!(
            plan(&stats, 4, command, viewport, offset, max)
                .unwrap()
                .is_none()
        );
        stats.frames = 2;
        let focused = stats.focused.take();
        assert!(
            plan(&stats, 4, command, viewport, offset, max)
                .unwrap()
                .is_none()
        );
        stats.focused = focused;
        assert!(
            plan(&stats, 4, command, viewport, point(px(0.), px(-100.)), max)
                .unwrap()
                .is_none()
        );
        command.handle.generation += 1;
        assert!(
            plan(&stats, 4, command, viewport, offset, max)
                .unwrap()
                .is_none()
        );
        stats.focused = Some(TextSource {
            handle: command.handle,
            node: command.node,
        });
        assert!(plan(&stats, 4, command, viewport, offset, max).is_err());
        stats.error = Some("layout failed".into());
        assert!(
            plan(&stats, 4, command, viewport, offset, max)
                .unwrap_err()
                .contains("layout failed")
        );
    }
}
