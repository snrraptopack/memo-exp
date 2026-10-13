use std::path::PathBuf;
use std::sync::Arc;

use blitz_traits::shell::{ClipboardError, FileDialogFilter, ShellProvider};
use cursor_icon::CursorIcon;

use super::PublicationProviders;

#[derive(Default)]
pub(super) struct ShellChanges {
    redraw: bool,
    title: Option<String>,
    cursor: Option<Option<CursorIcon>>,
    ime_enabled: Option<bool>,
    ime_area: Option<(f32, f32, f32, f32)>,
}

impl ShellChanges {
    pub fn release(self, shell: &dyn ShellProvider) {
        if let Some(title) = self.title {
            shell.set_window_title(title);
        }
        if let Some(cursor) = self.cursor {
            shell.set_cursor(cursor);
        }
        if let Some(enabled) = self.ime_enabled {
            shell.set_ime_enabled(enabled);
        }
        if let Some((x, y, width, height)) = self.ime_area {
            shell.set_ime_cursor_area(x, y, width, height);
        }
        if self.redraw {
            shell.request_redraw();
        }
    }
}

pub(super) struct ControlledShell(pub Arc<PublicationProviders>);

impl ShellProvider for ControlledShell {
    fn request_redraw(&self) {
        if !self.0.queue_shell(|pending| pending.redraw = true) {
            self.0.shell.request_redraw();
        }
    }

    fn set_window_title(&self, title: String) {
        // Only a title set during publication is copied into the pending record.
        if !self
            .0
            .queue_shell(|pending| pending.title = Some(title.clone()))
        {
            self.0.shell.set_window_title(title);
        }
    }

    fn set_cursor(&self, cursor: Option<CursorIcon>) {
        if !self.0.queue_shell(|pending| pending.cursor = Some(cursor)) {
            self.0.shell.set_cursor(cursor);
        }
    }

    fn set_ime_enabled(&self, enabled: bool) {
        if !self
            .0
            .queue_shell(|pending| pending.ime_enabled = Some(enabled))
        {
            self.0.shell.set_ime_enabled(enabled);
        }
    }

    fn set_ime_cursor_area(&self, x: f32, y: f32, width: f32, height: f32) {
        if !self
            .0
            .queue_shell(|pending| pending.ime_area = Some((x, y, width, height)))
        {
            self.0.shell.set_ime_cursor_area(x, y, width, height);
        }
    }

    // Synchronous platform results cannot be deferred. They remain real forwarded
    // capabilities outside publication; an unexpected scene-time query is fatal.
    fn get_clipboard_text(&self) -> Result<String, ClipboardError> {
        if self.0.interactive_allowed() {
            self.0.shell.get_clipboard_text()
        } else {
            Err(ClipboardError)
        }
    }

    fn set_clipboard_text(&self, text: String) -> Result<(), ClipboardError> {
        if self.0.interactive_allowed() {
            self.0.shell.set_clipboard_text(text)
        } else {
            Err(ClipboardError)
        }
    }

    fn open_file_dialog(&self, multiple: bool, filter: Option<FileDialogFilter>) -> Vec<PathBuf> {
        if self.0.interactive_allowed() {
            self.0.shell.open_file_dialog(multiple, filter)
        } else {
            Vec::new()
        }
    }

    fn request_window_close(&self) {
        if self.0.interactive_allowed() {
            self.0.shell.request_window_close();
        }
    }

    fn set_window_minimized(&self, minimized: bool) {
        if self.0.interactive_allowed() {
            self.0.shell.set_window_minimized(minimized);
        }
    }

    fn set_window_maximized(&self, maximized: bool) {
        if self.0.interactive_allowed() {
            self.0.shell.set_window_maximized(maximized);
        }
    }

    fn is_window_maximized(&self) -> bool {
        self.0.interactive_allowed() && self.0.shell.is_window_maximized()
    }

    fn set_window_decorations(&self, decorations: bool) {
        if self.0.interactive_allowed() {
            self.0.shell.set_window_decorations(decorations);
        }
    }

    fn drag_window(&self) {
        if self.0.interactive_allowed() {
            self.0.shell.drag_window();
        }
    }
}
