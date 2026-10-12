//! Resolve native cursor requests from the already measured inline ancestry.
use super::{InlineCursor, InlineSource};
use memoized_dom_desktop_host::presentation::TextSource;
use std::collections::BTreeMap;

/// The nearest explicit declaration wins. An explicit default cursor cancels
/// an ancestor's hand/text cursor; absence lets GPUI's enclosing box handle it.
pub fn resolve(
    sources: &[TextSource],
    metadata: &BTreeMap<(u64, u64, usize), InlineSource>,
) -> Option<InlineCursor> {
    sources.iter().rev().find_map(|source| {
        let key = (source.handle.id, source.handle.generation, source.node);
        metadata.get(&key)?.cursor.map(|style| InlineCursor {
            source: *source,
            style,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::CursorStyle;
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

    fn metadata(cursor: Option<CursorStyle>) -> InlineSource {
        InlineSource {
            tag: "span".into(),
            id: None,
            cursor,
        }
    }

    #[test]
    fn nested_sources_inherit_the_nearest_cursor_and_can_reset_it() {
        let mut styles = BTreeMap::from([
            ((7, 2, 1), metadata(Some(CursorStyle::PointingHand))),
            ((7, 2, 2), metadata(None)),
        ]);
        let ancestry = [source(1), source(2)];
        let inherited = resolve(&ancestry, &styles).unwrap();
        assert_eq!(inherited.source, source(1));
        assert_eq!(inherited.style, CursorStyle::PointingHand);

        styles.get_mut(&(7, 2, 2)).unwrap().cursor = Some(CursorStyle::IBeam);
        let text = resolve(&ancestry, &styles).unwrap();
        assert_eq!(text.source, source(2));
        assert_eq!(text.style, CursorStyle::IBeam);

        styles.get_mut(&(7, 2, 2)).unwrap().cursor = Some(CursorStyle::Arrow);
        assert_eq!(
            resolve(&ancestry, &styles).unwrap().style,
            CursorStyle::Arrow
        );
    }

    #[test]
    fn plain_text_and_retired_source_generations_do_not_request_a_cursor() {
        let styles = BTreeMap::from([((7, 2, 1), metadata(Some(CursorStyle::PointingHand)))]);
        let retired = TextSource {
            handle: Handle {
                id: 7,
                generation: 1,
            },
            node: 1,
        };
        assert!(resolve(&[], &styles).is_none());
        assert!(resolve(&[retired], &styles).is_none());
        assert!(resolve(&[source(2)], &styles).is_none());
    }
}
