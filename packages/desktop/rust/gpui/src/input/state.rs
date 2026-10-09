//! Single-line editing state. Byte offsets stay on Unicode character boundaries;
//! platform IME ranges are UTF-16, and cursor movement uses grapheme boundaries.
use std::ops::Range;
use unicode_segmentation::UnicodeSegmentation;

#[derive(Default)]
pub struct EditState {
    pub text: String,
    pub anchor: usize,
    pub caret: usize,
    pub marked: Option<Range<usize>>,
}
pub fn sanitize(text: &str) -> String {
    text.chars()
        .filter(|c| !matches!(c, '\r' | '\n' | '\u{2028}' | '\u{2029}'))
        .collect()
}
impl EditState {
    pub fn new(text: &str) -> Self {
        Self {
            text: sanitize(text),
            ..Self::default()
        }
    }
    pub fn selection(&self) -> Range<usize> {
        self.anchor.min(self.caret)..self.anchor.max(self.caret)
    }
    pub fn move_to(&mut self, offset: usize, extend: bool) {
        self.caret = self.boundary(offset);
        if !extend {
            self.anchor = self.caret;
        }
    }
    fn boundary(&self, offset: usize) -> usize {
        let mut offset = offset.min(self.text.len());
        while !self.text.is_char_boundary(offset) {
            offset -= 1;
        }
        offset
    }
    pub fn previous(&self) -> usize {
        self.text
            .grapheme_indices(true)
            .rev()
            .find(|(i, _)| *i < self.caret)
            .map_or(0, |(i, _)| i)
    }
    pub fn next(&self) -> usize {
        self.text
            .grapheme_indices(true)
            .find(|(i, _)| *i > self.caret)
            .map_or(self.text.len(), |(i, _)| i)
    }
    pub fn utf16_offset(&self, byte: usize) -> usize {
        self.text[..self.boundary(byte)].encode_utf16().count()
    }
    fn byte_offset(&self, units: usize, round_up: bool) -> usize {
        let mut consumed = 0;
        for (byte, ch) in self.text.char_indices() {
            if units == consumed {
                return byte;
            }
            if units < consumed + ch.len_utf16() {
                return if round_up { byte + ch.len_utf8() } else { byte };
            }
            consumed += ch.len_utf16();
        }
        self.text.len()
    }
    pub fn utf16_range(&self, range: &Range<usize>) -> Range<usize> {
        self.utf16_offset(range.start)..self.utf16_offset(range.end)
    }
    pub fn byte_range(&self, range: &Range<usize>) -> Range<usize> {
        let start = self.byte_offset(range.start.min(range.end), false);
        let end = if range.is_empty() {
            start
        } else {
            self.byte_offset(range.end.max(range.start), true)
        };
        start..end
    }
    pub fn set_value(&mut self, value: &str) {
        self.text = sanitize(value);
        self.anchor = self.boundary(self.anchor);
        self.caret = self.boundary(self.caret);
        self.marked = None;
    }
    pub fn replace(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        composition: Option<Option<Range<usize>>>,
    ) {
        let range = range
            .map(|r| self.byte_range(&r))
            .or_else(|| self.marked.clone())
            .unwrap_or_else(|| self.selection());
        let inserted = Self::new(text);
        self.text.replace_range(range.clone(), &inserted.text);
        let end = range.start + inserted.text.len();
        self.anchor = end;
        self.caret = end;
        self.marked = composition
            .as_ref()
            .filter(|_| !inserted.text.is_empty())
            .map(|_| range.start..end);
        if let Some(Some(selected)) = composition {
            let selected = inserted.byte_range(&selected);
            self.anchor = range.start + selected.start;
            self.caret = range.start + selected.end;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn grapheme_movement_and_surrogate_ranges_preserve_valid_text() {
        let mut state = EditState::new("a🙂e\u{301}静");
        state.move_to(state.text.len(), false);
        assert_eq!(state.previous(), 8);
        state.move_to(8, false);
        assert_eq!(state.previous(), 5);
        assert_eq!(state.byte_range(&(2..2)), 1..1);
        assert_eq!(state.byte_range(&(2..3)), 1..5);
        state.replace(Some(1..3), "é", None);
        assert_eq!(state.text, "aée\u{301}静");
    }
    #[test]
    fn composition_selection_is_relative_to_inserted_text_and_commit_replaces_mark() {
        let mut state = EditState::new("prefix suffix");
        state.move_to(7, false);
        state.replace(None, "🙂静", Some(Some(2..3)));
        assert_eq!(state.marked, Some(7..14));
        assert_eq!(state.selection(), 11..14);
        state.replace(None, "字", None);
        assert_eq!(state.text, "prefix 字suffix");
        assert!(state.marked.is_none());
    }
    #[test]
    fn programmatic_updates_clamp_selection_and_single_line_values_are_sanitized() {
        let mut state = EditState::new("long text");
        state.move_to(9, true);
        state.set_value("é\r\n");
        assert_eq!(state.text, "é");
        assert_eq!(state.selection(), 0..2);
    }
}
