//! Retained single-line control using GPUI's platform text-input interface.
//! GPUI owns key dispatch, clipboard, font shaping, focus and IME integration.
mod binding;
mod state;
#[cfg(debug_assertions)]
pub mod testing;
use crate::renderer::Stats;
use binding::BindingState;
use gpui::{
    App, Bounds, ClipboardItem, Context, Element, ElementId, ElementInputHandler, Entity,
    EntityInputHandler, FocusHandle, GlobalElementId, InspectorElementId, IntoElement, KeyBinding,
    LayoutId, MouseButton, MouseDownEvent, MouseMoveEvent, MouseUpEvent, Pixels, Point, Render,
    Role, ShapedLine, Style, TextAlign, TextStyle, UTF16Selection, UnderlineStyle, Window, actions,
    div, fill, point, prelude::*, px, relative, rgba, size,
};
use state::EditState;
use std::{cell::RefCell, ops::Range, rc::Rc};

actions!(
    desktop_input,
    [
        Backspace,
        Delete,
        Left,
        Right,
        SelectLeft,
        SelectRight,
        SelectAll,
        Home,
        End,
        Paste,
        Copy,
        Cut
    ]
);
pub fn bind_keys(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("backspace", Backspace, Some("DesktopInput")),
        KeyBinding::new("delete", Delete, Some("DesktopInput")),
        KeyBinding::new("left", Left, Some("DesktopInput")),
        KeyBinding::new("right", Right, Some("DesktopInput")),
        KeyBinding::new("shift-left", SelectLeft, Some("DesktopInput")),
        KeyBinding::new("shift-right", SelectRight, Some("DesktopInput")),
        KeyBinding::new("home", Home, Some("DesktopInput")),
        KeyBinding::new("end", End, Some("DesktopInput")),
        KeyBinding::new("ctrl-a", SelectAll, Some("DesktopInput")),
        KeyBinding::new("ctrl-v", Paste, Some("DesktopInput")),
        KeyBinding::new("ctrl-c", Copy, Some("DesktopInput")),
        KeyBinding::new("ctrl-x", Cut, Some("DesktopInput")),
    ]);
}
pub type ChangeSink = Rc<dyn Fn(String, u64, &mut App)>;
pub struct InputOptions {
    pub placeholder: String,
    pub label: String,
    pub controlled: bool,
    pub expect_ack: bool,
}
struct CachedLine {
    style: TextStyle,
    marked: Option<Range<usize>>,
    font_size: Pixels,
    scale: f32,
    line: ShapedLine,
}
pub struct TextInput {
    #[cfg(debug_assertions)]
    pub painted_text: String,
    focus: FocusHandle,
    state: EditState,
    placeholder: String,
    label: String,
    binding: BindingState,
    sink: ChangeSink,
    selecting: bool,
    scroll: Pixels,
    bounds: Option<Bounds<Pixels>>,
    shaped: Option<CachedLine>,
    stats: Rc<RefCell<Stats>>,
}
impl TextInput {
    pub fn new(
        focus: FocusHandle,
        value: &str,
        options: InputOptions,
        sink: ChangeSink,
        stats: Rc<RefCell<Stats>>,
    ) -> Self {
        let state = EditState::new(value);
        Self {
            #[cfg(debug_assertions)]
            painted_text: String::new(),
            binding: BindingState::new(value, &state, options.controlled, options.expect_ack),
            state,
            focus,
            placeholder: options.placeholder,
            label: options.label,
            sink,
            selecting: false,
            scroll: px(0.),
            bounds: None,
            shaped: None,
            stats,
        }
    }
    pub fn set_focus(&mut self, focus: FocusHandle) {
        self.focus = focus;
    }
    pub fn sync(&mut self, value: &str, cx: &mut Context<Self>) {
        if self.binding.sync(value, &mut self.state) {
            cx.notify();
        }
    }
    pub fn acknowledge(
        &mut self,
        edit: u64,
        value: &str,
        cx: &mut Context<Self>,
    ) -> Result<(), String> {
        if self.binding.acknowledge(edit, value, &mut self.state)? {
            cx.notify();
        }
        Ok(())
    }
    fn publish(&mut self, cx: &mut Context<Self>) {
        if let Some((value, edit)) = self.binding.publish(&mut self.state) {
            (self.sink)(value, edit, cx);
        }
        cx.notify();
    }
    fn left(&mut self, _: &Left, _: &mut Window, cx: &mut Context<Self>) {
        let range = self.state.selection();
        let offset = if range.is_empty() {
            self.state.previous()
        } else {
            range.start
        };
        self.state.move_to(offset, false);
        cx.notify();
    }
    fn right(&mut self, _: &Right, _: &mut Window, cx: &mut Context<Self>) {
        let range = self.state.selection();
        let offset = if range.is_empty() {
            self.state.next()
        } else {
            range.end
        };
        self.state.move_to(offset, false);
        cx.notify();
    }
    fn select_left(&mut self, _: &SelectLeft, _: &mut Window, cx: &mut Context<Self>) {
        self.state.move_to(self.state.previous(), true);
        cx.notify();
    }
    fn select_right(&mut self, _: &SelectRight, _: &mut Window, cx: &mut Context<Self>) {
        self.state.move_to(self.state.next(), true);
        cx.notify();
    }
    fn select_all(&mut self, _: &SelectAll, _: &mut Window, cx: &mut Context<Self>) {
        self.state.anchor = 0;
        self.state.caret = self.state.text.len();
        cx.notify();
    }
    fn home(&mut self, _: &Home, _: &mut Window, cx: &mut Context<Self>) {
        self.state.move_to(0, false);
        cx.notify();
    }
    fn end(&mut self, _: &End, _: &mut Window, cx: &mut Context<Self>) {
        self.state.move_to(self.state.text.len(), false);
        cx.notify();
    }
    fn backspace(&mut self, _: &Backspace, window: &mut Window, cx: &mut Context<Self>) {
        if self.state.selection().is_empty() {
            self.state.move_to(self.state.previous(), true);
        }
        self.replace_text_in_range(None, "", window, cx);
    }
    fn delete(&mut self, _: &Delete, window: &mut Window, cx: &mut Context<Self>) {
        if self.state.selection().is_empty() {
            self.state.move_to(self.state.next(), true);
        }
        self.replace_text_in_range(None, "", window, cx);
    }
    fn paste(&mut self, _: &Paste, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(text) = cx.read_from_clipboard().and_then(|item| item.text()) {
            self.replace_text_in_range(None, &text, window, cx);
        }
    }
    fn copy(&mut self, _: &Copy, _: &mut Window, cx: &mut Context<Self>) {
        let selected = self.state.selection();
        if !selected.is_empty() {
            cx.write_to_clipboard(ClipboardItem::new_string(self.state.text[selected].into()));
        }
    }
    fn cut(&mut self, _: &Cut, window: &mut Window, cx: &mut Context<Self>) {
        self.copy(&Copy, window, cx);
        self.replace_text_in_range(None, "", window, cx);
    }
    fn index(&self, position: Point<Pixels>) -> usize {
        match (&self.shaped, self.bounds) {
            (Some(shaped), Some(bounds)) if !self.state.text.is_empty() => shaped
                .line
                .closest_index_for_x(position.x - bounds.left() + self.scroll),
            _ => 0,
        }
    }
    fn mouse_down(&mut self, event: &MouseDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        window.focus(&self.focus, cx);
        self.selecting = true;
        self.state
            .move_to(self.index(event.position), event.modifiers.shift);
        cx.notify();
    }
    fn mouse_move(&mut self, event: &MouseMoveEvent, _: &mut Window, cx: &mut Context<Self>) {
        if self.selecting {
            self.state.move_to(self.index(event.position), true);
            cx.notify();
        }
    }
    fn mouse_up(&mut self, _: &MouseUpEvent, _: &mut Window, _: &mut Context<Self>) {
        self.selecting = false;
    }
}
impl EntityInputHandler for TextInput {
    fn text_for_range(
        &mut self,
        range: Range<usize>,
        actual: &mut Option<Range<usize>>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<String> {
        let range = self.state.byte_range(&range);
        *actual = Some(self.state.utf16_range(&range));
        Some(self.state.text[range].into())
    }
    fn selected_text_range(
        &mut self,
        _: bool,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<UTF16Selection> {
        Some(UTF16Selection {
            range: self.state.utf16_range(&self.state.selection()),
            reversed: self.state.caret < self.state.anchor,
        })
    }
    fn marked_text_range(&self, _: &mut Window, _: &mut Context<Self>) -> Option<Range<usize>> {
        self.state
            .marked
            .as_ref()
            .map(|range| self.state.utf16_range(range))
    }
    fn unmark_text(&mut self, _: &mut Window, cx: &mut Context<Self>) {
        self.state.marked = None;
        self.publish(cx);
    }
    fn replace_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.state.replace(range, text, None);
        self.publish(cx);
    }
    fn replace_and_mark_text_in_range(
        &mut self,
        range: Option<Range<usize>>,
        text: &str,
        selected: Option<Range<usize>>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.state.replace(range, text, Some(selected));
        cx.notify();
    }
    fn bounds_for_range(
        &mut self,
        range: Range<usize>,
        _: Bounds<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<Bounds<Pixels>> {
        let range = self.state.byte_range(&range);
        let bounds = self.bounds?;
        let line = &self.shaped.as_ref()?.line;
        Some(Bounds::from_corners(
            point(
                bounds.left() + line.x_for_index(range.start) - self.scroll,
                bounds.top(),
            ),
            point(
                bounds.left() + line.x_for_index(range.end) - self.scroll,
                bounds.bottom(),
            ),
        ))
    }
    fn character_index_for_point(
        &mut self,
        position: Point<Pixels>,
        _: &mut Window,
        _: &mut Context<Self>,
    ) -> Option<usize> {
        let bounds = self.bounds?;
        if position.y < bounds.top() || position.y > bounds.bottom() {
            return None;
        }
        Some(self.state.utf16_offset(self.index(position)))
    }
}
impl Render for TextInput {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        div()
            .id("text-input")
            .w_full()
            .min_w_0()
            .overflow_hidden()
            .track_focus(&self.focus)
            .key_context("DesktopInput")
            .role(Role::TextInput)
            .aria_label(self.label.clone())
            .aria_value(self.state.text.clone())
            .on_action(cx.listener(Self::left))
            .on_action(cx.listener(Self::right))
            .on_action(cx.listener(Self::select_left))
            .on_action(cx.listener(Self::select_right))
            .on_action(cx.listener(Self::select_all))
            .on_action(cx.listener(Self::home))
            .on_action(cx.listener(Self::end))
            .on_action(cx.listener(Self::backspace))
            .on_action(cx.listener(Self::delete))
            .on_action(cx.listener(Self::paste))
            .on_action(cx.listener(Self::copy))
            .on_action(cx.listener(Self::cut))
            .on_mouse_down(MouseButton::Left, cx.listener(Self::mouse_down))
            .on_mouse_move(cx.listener(Self::mouse_move))
            .on_mouse_up(MouseButton::Left, cx.listener(Self::mouse_up))
            .on_mouse_up_out(MouseButton::Left, cx.listener(Self::mouse_up))
            .child(InputText { input: cx.entity() })
    }
}
struct InputText {
    input: Entity<TextInput>,
}
pub struct PaintState {
    line: ShapedLine,
    scroll: Pixels,
    selection: Range<usize>,
    caret: usize,
}
impl IntoElement for InputText {
    type Element = Self;
    fn into_element(self) -> Self {
        self
    }
}
impl Element for InputText {
    type RequestLayoutState = ();
    type PrepaintState = PaintState;
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
        let mut style = Style::default();
        style.size.width = relative(1.).into();
        style.size.height = window.line_height().into();
        (window.request_layout(style, [], cx), ())
    }
    fn prepaint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        window: &mut Window,
        cx: &mut App,
    ) -> PaintState {
        let style = window.text_style();
        let font_size = style.font_size.to_pixels(window.rem_size());
        let scale = window.scale_factor();
        self.input.update(cx, |input, _| {
            let display: gpui::SharedString = if input.state.text.is_empty() {
                input.placeholder.clone().into()
            } else {
                input.state.text.clone().into()
            };
            let marked = input.state.marked.clone();
            let cached = input.shaped.as_ref().filter(|cached| {
                cached.style == style
                    && cached.marked == marked
                    && cached.line.text == display
                    && cached.font_size == font_size
                    && cached.scale == scale
            });
            let line = if let Some(cached) = cached {
                cached.line.clone()
            } else {
                let mut base = style.to_run(display.len());
                if input.state.text.is_empty() {
                    base.color.a *= 0.5;
                }
                let runs = if let Some(range) = &marked {
                    [
                        (range.start, None),
                        (
                            range.end - range.start,
                            Some(UnderlineStyle {
                                thickness: px(1.),
                                color: None,
                                wavy: false,
                            }),
                        ),
                        (display.len() - range.end, None),
                    ]
                    .into_iter()
                    .filter(|(len, _)| *len > 0)
                    .map(|(len, underline)| gpui::TextRun {
                        len,
                        underline,
                        ..base.clone()
                    })
                    .collect::<Vec<_>>()
                } else {
                    vec![base]
                };
                input.stats.borrow_mut().shaping += 1;
                window
                    .text_system()
                    .shape_line(display, font_size, &runs, None)
            };
            let caret = line.x_for_index(input.state.caret);
            if caret < input.scroll {
                input.scroll = caret;
            }
            let available = (bounds.size.width - px(2.)).max(px(0.));
            if caret > input.scroll + available {
                input.scroll = caret - available;
            }
            input.scroll = input.scroll.min((line.width - available).max(px(0.)));
            input.bounds = Some(bounds);
            input.shaped = Some(CachedLine {
                style: style.clone(),
                marked,
                font_size,
                scale,
                line: line.clone(),
            });
            PaintState {
                line,
                scroll: input.scroll,
                selection: input.state.selection(),
                caret: input.state.caret,
            }
        })
    }
    fn paint(
        &mut self,
        _: Option<&GlobalElementId>,
        _: Option<&InspectorElementId>,
        bounds: Bounds<Pixels>,
        _: &mut (),
        state: &mut PaintState,
        window: &mut Window,
        cx: &mut App,
    ) {
        let focus = self.input.read(cx).focus.clone();
        #[cfg(debug_assertions)]
        self.input.update(cx, |input, _| {
            input.painted_text = input.state.text.clone();
        });
        window.handle_input(
            &focus,
            ElementInputHandler::new(bounds, self.input.clone()),
            cx,
        );
        let origin = point(bounds.left() - state.scroll, bounds.top());
        if !state.selection.is_empty() {
            window.paint_quad(fill(
                Bounds::from_corners(
                    point(
                        origin.x + state.line.x_for_index(state.selection.start),
                        bounds.top(),
                    ),
                    point(
                        origin.x + state.line.x_for_index(state.selection.end),
                        bounds.bottom(),
                    ),
                ),
                rgba(0x2563eb40),
            ));
        }
        if let Err(error) = state.line.paint(
            origin,
            window.line_height(),
            TextAlign::Left,
            None,
            window,
            cx,
        ) {
            eprintln!("Native input paint failed: {error}");
        }
        if focus.is_focused(window) && state.selection.is_empty() {
            window.paint_quad(fill(
                Bounds::new(
                    point(origin.x + state.line.x_for_index(state.caret), bounds.top()),
                    size(px(1.), bounds.size.height),
                ),
                window.text_style().color,
            ));
        }
    }
}
