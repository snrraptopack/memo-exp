//! Read the adapter's completed geometry; never run a second layout calculation.
use crate::renderer::Stats;
use memoized_dom_desktop_host::Handle;
use serde::Serialize;
use serde_json::{Value, json};

#[derive(Clone, Copy, Serialize)]
struct Rect {
    x: f32,
    y: f32,
    width: f32,
    height: f32,
}

pub struct PendingMeasurement {
    pub handle: Handle,
    pub node: usize,
    pub complete: Box<dyn FnOnce(Result<Value, String>)>,
}

pub fn read(stats: &Stats, handle: Handle, node: usize) -> Result<Value, String> {
    if let Some(error) = &stats.error {
        return Err(format!("Native measurement unavailable: {error}"));
    }
    // A placed inline element can also appear in descendant text ancestry.
    // Its own capability measures the layout box, not both overlapping views.
    let regions = if stats
        .boxes
        .iter()
        .any(|region| region.handle == handle && region.source == node)
    {
        &stats.boxes
    } else {
        &stats.inline_ranges
    };
    let rects: Vec<Rect> = regions
        .iter()
        .filter(|region| region.handle == handle && region.source == node)
        .map(|region| Rect {
            x: region.x,
            y: region.y,
            width: region.width,
            height: region.height,
        })
        .collect();
    let bounds = rects.iter().copied().reduce(|a, b| {
        let x = a.x.min(b.x);
        let y = a.y.min(b.y);
        Rect {
            x,
            y,
            width: (a.x + a.width).max(b.x + b.width) - x,
            height: (a.y + a.height).max(b.y + b.height) - y,
        }
    });
    Ok(json!({
        "handle": handle, "node": node,
        "sequence": stats.sequence, "frame": stats.frames,
        "rects": rects, "bounds": bounds
    }))
}

/// Resolve only after all roots have painted. A source can retire while waiting.
pub fn finish(
    pending: &mut Vec<PendingMeasurement>,
    stats: &Stats,
    live: impl Fn(Handle, usize) -> bool,
) {
    for request in pending.drain(..) {
        let result = if live(request.handle, request.node) {
            read(stats, request.handle, request.node)
        } else {
            Err("Measurement requires a live element source".into())
        };
        (request.complete)(result);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::renderer::LayoutBox;
    use gpui::{Bounds, point, px, size};
    use std::{cell::RefCell, rc::Rc};

    #[test]
    fn native_box_takes_precedence_over_descendant_glyph_ancestry() {
        let handle = Handle {
            id: 2,
            generation: 1,
        };
        let mut stats = Stats::default();
        let region = || {
            LayoutBox::new(
                handle,
                0,
                "span".into(),
                None,
                Bounds::new(point(px(10.), px(20.)), size(px(200.), px(80.))),
            )
        };
        stats.boxes.push(region());
        stats.inline_ranges.push(region());
        let measured = read(&stats, handle, 0).unwrap();
        assert_eq!(measured["rects"].as_array().unwrap().len(), 1);
        assert_eq!(measured["bounds"]["width"], 200.);
        stats.error = Some("layout failure".into());
        assert!(read(&stats, handle, 0).is_err());
    }

    #[test]
    fn wrapped_geometry_preserves_offscreen_rectangles_and_source_identity() {
        let handle = Handle {
            id: 1,
            generation: 2,
        };
        let mut stats = Stats::default();
        stats.frames = 4;
        stats.sequence = 7;
        for (x, y, width) in [(20., -10., 80.), (20., 10., 30.)] {
            stats.inline_ranges.push(LayoutBox::new(
                handle,
                3,
                "span".into(),
                None,
                Bounds::new(point(px(x), px(y)), size(px(width), px(20.))),
            ));
        }
        let result = read(&stats, handle, 3).unwrap();
        assert_eq!(result["rects"].as_array().unwrap().len(), 2);
        assert_eq!(
            result["bounds"],
            json!({"x":20., "y":-10., "width":80., "height":40.})
        );
        assert_eq!(result["sequence"], 7);
        assert_eq!(result["frame"], 4);
        assert_eq!(
            read(
                &stats,
                Handle {
                    id: 1,
                    generation: 3
                },
                3
            )
            .unwrap()["bounds"],
            Value::Null
        );
        assert_eq!(read(&stats, handle, 4).unwrap()["rects"], json!([]));
    }

    #[test]
    fn pending_reads_revalidate_retired_sources_and_resolve_once() {
        let answers = Rc::new(RefCell::new(Vec::new()));
        let received = answers.clone();
        let mut pending = vec![PendingMeasurement {
            handle: Handle {
                id: 1,
                generation: 1,
            },
            node: 0,
            complete: Box::new(move |result| received.borrow_mut().push(result)),
        }];
        finish(&mut pending, &Stats::default(), |_, _| false);
        finish(&mut pending, &Stats::default(), |_, _| true);
        assert_eq!(answers.borrow().len(), 1);
        assert!(answers.borrow()[0].is_err());
    }
}
