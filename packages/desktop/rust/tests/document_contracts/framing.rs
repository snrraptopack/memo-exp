//! Partial I/O, bounds and lost acceptance are process-boundary contracts.

use std::io::{self, Cursor, Read, Write};

use super::{body_text, host};
use memoized_dom_desktop::protocol::{
    FrameError, FrameReader, FrameWriter, MAX_PACKET_BYTES, ProtocolError, PublicationSession,
};
use serde_json::json;

struct OneByteReads {
    bytes: Cursor<Vec<u8>>,
    interrupt: bool,
}

impl Read for OneByteReads {
    fn read(&mut self, bytes: &mut [u8]) -> io::Result<usize> {
        if self.interrupt {
            self.interrupt = false;
            return Err(io::ErrorKind::Interrupted.into());
        }
        let length = bytes.len().min(1);
        self.bytes.read(&mut bytes[..length])
    }
}

#[test]
fn adjacent_frames_survive_split_headers_payloads_interrupts_and_utf8() {
    let mut stream = Vec::new();
    let first = json!({"text": "héllo\nworld"});
    {
        let mut writer = FrameWriter::new(&mut stream);
        writer.write_json(&first).unwrap();
        writer.write_json(&json!({"sequence": 2})).unwrap();
    }
    let mut reader = FrameReader::new(OneByteReads {
        bytes: Cursor::new(stream),
        interrupt: true,
    });
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&reader.read_packet().unwrap().unwrap())
            .unwrap(),
        first
    );
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&reader.read_packet().unwrap().unwrap())
            .unwrap(),
        json!({"sequence": 2})
    );
    assert!(reader.read_packet().unwrap().is_none());
    assert!(reader.is_closed());
    assert!(matches!(reader.read_packet(), Err(FrameError::Closed)));
}

#[test]
fn incomplete_prefix_or_payload_closes_without_resynchronization() {
    for stream in [vec![0], vec![0, 0, 0], vec![0, 0, 0, 3, b'a']] {
        let mut reader = FrameReader::new(Cursor::new(stream));
        let error = reader.read_packet().unwrap_err();
        assert!(
            matches!(error, FrameError::Io(ref error) if error.kind() == io::ErrorKind::UnexpectedEof)
        );
        assert!(reader.is_closed());
        assert!(matches!(reader.read_packet(), Err(FrameError::Closed)));
    }
}

#[test]
fn invalid_declared_length_refuses_before_reading_or_allocating_payload() {
    for length in [0, MAX_PACKET_BYTES as u32 + 1, u32::MAX] {
        // No payload bytes are supplied. A premature payload read would give EOF
        // instead of the required length refusal at the allocation boundary.
        let mut reader = FrameReader::new(Cursor::new(length.to_be_bytes()));
        assert!(
            matches!(reader.read_packet(), Err(FrameError::InvalidLength(found)) if found == length as usize)
        );
        assert!(reader.is_closed());
    }
}

#[test]
fn exact_payload_limit_roundtrips_and_local_oversize_writes_emit_no_prefix() {
    let mut stream = Vec::new();
    let bytes = vec![b'x'; MAX_PACKET_BYTES];
    {
        let mut writer = FrameWriter::new(&mut stream);
        assert!(matches!(
            writer.write_packet(&[]),
            Err(FrameError::InvalidLength(0))
        ));
        assert!(matches!(
            writer.write_packet(&vec![0; MAX_PACKET_BYTES + 1]),
            Err(FrameError::InvalidLength(_))
        ));
        assert!(!writer.is_closed());
        writer.write_packet(&bytes).unwrap();
    }
    assert_eq!(stream.len(), MAX_PACKET_BYTES + 4);
    let mut reader = FrameReader::new(Cursor::new(stream));
    assert_eq!(reader.read_packet().unwrap().unwrap(), bytes);
}

#[test]
fn outgoing_json_is_bounded_before_prefix_emission() {
    let mut stream = Vec::new();
    {
        let mut writer = FrameWriter::new(&mut stream);
        assert!(matches!(
            writer.write_json(&"x".repeat(MAX_PACKET_BYTES)),
            Err(FrameError::InvalidLength(_))
        ));
        assert!(!writer.is_closed());
        writer.write_json(&json!({"ok": true})).unwrap();
    }
    let mut reader = FrameReader::new(Cursor::new(stream));
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&reader.read_packet().unwrap().unwrap())
            .unwrap(),
        json!({"ok": true})
    );
    assert!(reader.read_packet().unwrap().is_none());
}

struct FailingWriter {
    remaining: usize,
    fail_flush: bool,
}

impl Write for FailingWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if self.remaining == 0 {
            return Err(io::ErrorKind::BrokenPipe.into());
        }
        let written = self.remaining.min(bytes.len());
        self.remaining -= written;
        Ok(written)
    }

    fn flush(&mut self) -> io::Result<()> {
        if self.fail_flush {
            Err(io::ErrorKind::BrokenPipe.into())
        } else {
            Ok(())
        }
    }
}

#[test]
fn header_payload_and_flush_failures_are_terminal() {
    for (remaining, fail_flush) in [(0, false), (2, false), (5, false), (usize::MAX, true)] {
        let mut writer = FrameWriter::new(FailingWriter {
            remaining,
            fail_flush,
        });
        assert!(matches!(
            writer.write_packet(b"hello"),
            Err(FrameError::Io(_))
        ));
        assert!(writer.is_closed());
        assert!(matches!(
            writer.write_packet(b"retry"),
            Err(FrameError::Closed)
        ));
    }
}

fn mounted_packet() -> Vec<u8> {
    serde_json::to_vec(&json!({"version": 1, "sequence": 1,
        "templates": [{"key": "row", "nodes": [{"node": {"kind": "text", "value": "applied"}}]}],
        "operations": [{"op": "mount", "owner": {"id": "row", "generation": 1}, "template": "row", "target": {"kind": "body"}}]
    })).unwrap()
}

#[test]
fn lost_acknowledgment_after_native_application_closes_without_replay() {
    let (document, _) = host();
    let mut session = PublicationSession::new(document);
    let mut writer = FrameWriter::new(FailingWriter {
        remaining: 5,
        fail_flush: false,
    });
    let packet = mounted_packet();
    assert!(matches!(
        session.publish_to(&packet, &mut writer),
        Err(ProtocolError::AcknowledgmentFailed(_))
    ));
    assert_eq!(body_text(session.document()), "applied");
    assert!(session.is_closed());
    assert!(writer.is_closed());
    assert_eq!(session.publish(&packet), Err(ProtocolError::Closed));
}

#[test]
fn known_closed_reply_stream_prevents_native_application() {
    let (document, shell) = host();
    let mut session = PublicationSession::new(document);
    let mut writer = FrameWriter::new(FailingWriter {
        remaining: 0,
        fail_flush: false,
    });
    assert!(writer.write_packet(b"failure").is_err());
    assert_eq!(
        session.publish_to(&mounted_packet(), &mut writer),
        Err(ProtocolError::Closed)
    );
    assert_eq!(session.document().owner_count(), 0);
    assert_eq!(session.template_count(), 0);
    assert_eq!(shell.redraws.load(std::sync::atomic::Ordering::SeqCst), 0);
}

#[test]
fn successful_publication_sends_one_structural_acceptance_frame() {
    let (document, _) = host();
    let mut session = PublicationSession::new(document);
    let mut stream = Vec::new();
    let accepted = session
        .publish_to(&mounted_packet(), &mut FrameWriter::new(&mut stream))
        .unwrap();
    assert_eq!(accepted.sequence(), 1);
    let mut reader = FrameReader::new(Cursor::new(stream));
    let reply: serde_json::Value =
        serde_json::from_slice(&reader.read_packet().unwrap().unwrap()).unwrap();
    assert_eq!(
        reply,
        json!({"version": 1, "sequence": 1, "status": "accepted"})
    );
    assert!(reader.read_packet().unwrap().is_none());
}
