//! Bounded framing for the persistent process stream.
//!
//! Each frame is a four-byte big-endian length followed by that many JSON bytes.
//! Blocking stream readers/writers belong on transport workers, not the native UI
//! thread. This module has no document/state ownership or platform event loop.

use std::fmt;
use std::io::{self, Read, Write};

use serde::Serialize;

use super::MAX_PACKET_BYTES;

#[derive(Debug)]
pub enum FrameError {
    Closed,
    InvalidLength(usize),
    Io(io::Error),
    Encoding(serde_json::Error),
}

impl fmt::Display for FrameError {
    fn fmt(&self, output: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Closed => write!(output, "desktop frame stream is closed"),
            Self::InvalidLength(length) => write!(
                output,
                "desktop frame length {length} is outside the permitted range"
            ),
            Self::Io(error) => write!(output, "desktop frame I/O failed: {error}"),
            Self::Encoding(error) => write!(output, "desktop frame encoding failed: {error}"),
        }
    }
}

impl std::error::Error for FrameError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            Self::Io(error) => Some(error),
            Self::Encoding(error) => Some(error),
            _ => None,
        }
    }
}

pub struct FrameReader<R> {
    reader: R,
    closed: bool,
}

impl<R: Read> FrameReader<R> {
    pub fn new(reader: R) -> Self {
        Self {
            reader,
            closed: false,
        }
    }

    pub fn is_closed(&self) -> bool {
        self.closed
    }

    /// None means a clean EOF at a frame boundary. Partial headers/payloads and
    /// invalid lengths are terminal; never guess a new boundary or replay bytes.
    pub fn read_packet(&mut self) -> Result<Option<Vec<u8>>, FrameError> {
        if self.closed {
            return Err(FrameError::Closed);
        }
        match self.read_frame() {
            Ok(Some(bytes)) => Ok(Some(bytes)),
            Ok(None) => {
                self.closed = true;
                Ok(None)
            }
            Err(error) => {
                self.closed = true;
                Err(error)
            }
        }
    }

    fn read_frame(&mut self) -> Result<Option<Vec<u8>>, FrameError> {
        let mut header = [0; 4];
        // Distinguish clean EOF from an incomplete prefix. read_exact retries
        // interrupted reads for the remaining header and payload below.
        loop {
            match self.reader.read(&mut header[..1]) {
                Ok(0) => return Ok(None),
                Ok(_) => break,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(FrameError::Io(error)),
            }
        }
        self.reader
            .read_exact(&mut header[1..])
            .map_err(FrameError::Io)?;
        let length = u32::from_be_bytes(header) as usize;
        if length == 0 || length > MAX_PACKET_BYTES {
            return Err(FrameError::InvalidLength(length));
        }
        // The untrusted declared length has passed the limit before allocation.
        let mut bytes = vec![0; length];
        self.reader.read_exact(&mut bytes).map_err(FrameError::Io)?;
        Ok(Some(bytes))
    }
}

pub struct FrameWriter<W> {
    writer: W,
    closed: bool,
}

/// Serialize into bounded memory before emitting the length prefix. Outgoing
/// JSON must not bypass the byte cap by allocating an unrestricted intermediate.
#[derive(Default)]
struct PayloadBuffer {
    bytes: Vec<u8>,
    overflow: Option<usize>,
}

impl Write for PayloadBuffer {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let length = self.bytes.len().saturating_add(bytes.len());
        if length > MAX_PACKET_BYTES {
            self.overflow = Some(length);
            return Err(io::Error::other("desktop JSON exceeds the frame limit"));
        }
        if length > self.bytes.capacity() {
            let capacity = length
                .max(self.bytes.capacity().saturating_mul(2))
                .min(MAX_PACKET_BYTES);
            self.bytes.reserve_exact(capacity - self.bytes.len());
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl<W: Write> FrameWriter<W> {
    pub fn new(writer: W) -> Self {
        Self {
            writer,
            closed: false,
        }
    }

    pub fn is_closed(&self) -> bool {
        self.closed
    }

    pub fn write_json(&mut self, value: &impl Serialize) -> Result<(), FrameError> {
        if self.closed {
            return Err(FrameError::Closed);
        }
        let mut payload = PayloadBuffer::default();
        if let Err(error) = serde_json::to_writer(&mut payload, value) {
            return Err(match payload.overflow {
                Some(length) => FrameError::InvalidLength(length),
                None => FrameError::Encoding(error),
            });
        }
        self.write_packet(&payload.bytes)
    }

    pub fn write_packet(&mut self, bytes: &[u8]) -> Result<(), FrameError> {
        if self.closed {
            return Err(FrameError::Closed);
        }
        // Refuse a local size error before emitting any prefix. The caller can
        // correct it; once I/O starts, every write/flush error closes the stream.
        if bytes.is_empty() || bytes.len() > MAX_PACKET_BYTES {
            return Err(FrameError::InvalidLength(bytes.len()));
        }
        let result = self
            .writer
            .write_all(&(bytes.len() as u32).to_be_bytes())
            .and_then(|_| self.writer.write_all(bytes))
            .and_then(|_| self.writer.flush());
        if let Err(error) = result {
            self.closed = true;
            return Err(FrameError::Io(error));
        }
        Ok(())
    }
}
