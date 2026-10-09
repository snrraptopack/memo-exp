//! All stdout messages use one writer; GPUI logs must remain on stderr.
use serde_json::Value;
use std::{
    cell::RefCell,
    io::{self, Write},
    rc::Rc,
};

#[derive(Clone)]
pub struct Output(Rc<RefCell<io::BufWriter<io::Stdout>>>);
impl Output {
    pub fn new() -> Self {
        Self(Rc::new(RefCell::new(io::BufWriter::new(io::stdout()))))
    }
    pub fn send(&self, value: &Value) -> io::Result<()> {
        let mut writer = self.0.borrow_mut();
        serde_json::to_writer(&mut *writer, value)?;
        writeln!(writer)?;
        writer.flush()
    }
}
