use serde::Serialize;

use crate::document::{DocumentError, Mutation, NativeDocument};

use super::wire::{DecodedPacket, MAX_SAFE_INTEGER};
use super::{PROTOCOL_VERSION, ProtocolError};

/// An acknowledgment of structural application, not layout or a painted frame.
#[derive(Debug, Eq, PartialEq, Serialize)]
pub struct Acceptance {
    version: u32,
    sequence: u64,
    status: AcceptanceStatus,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
enum AcceptanceStatus {
    Accepted,
}

impl Acceptance {
    pub fn sequence(&self) -> u64 {
        self.sequence
    }
}

/// Owns the document and serializes publications for one process connection.
/// There is no mutable document escape hatch: successful application is the only
/// operation that advances this connection's accepted scene sequence.
pub struct PublicationSession {
    document: NativeDocument,
    next_sequence: Option<u64>,
    closed: bool,
}

impl PublicationSession {
    pub fn new(document: NativeDocument) -> Self {
        let closed = document.is_failed();
        Self {
            document,
            next_sequence: Some(1),
            closed,
        }
    }

    pub fn document(&self) -> &NativeDocument {
        &self.document
    }

    pub fn is_closed(&self) -> bool {
        self.closed
    }

    /// Deliver complete framed JSON bytes. Decode/reference refusals leave the
    /// sequence available for correction; duplicates and gaps never reapply work.
    pub fn publish(&mut self, bytes: &[u8]) -> Result<Acceptance, ProtocolError> {
        self.publish_with(bytes, NativeDocument::update)
    }

    /// A transport that loses an acknowledgment must close rather than replay it.
    /// The process driver must also fail its pending jobs and drop this session;
    /// this flag prevents any further application while shutdown is in progress.
    pub fn close(&mut self) {
        self.closed = true;
    }

    fn publish_with(
        &mut self,
        bytes: &[u8],
        apply: impl FnOnce(&mut NativeDocument, &[Mutation]) -> Result<(), DocumentError>,
    ) -> Result<Acceptance, ProtocolError> {
        if self.closed {
            return Err(ProtocolError::Closed);
        }
        let expected = self.next_sequence.ok_or(ProtocolError::SequenceExhausted)?;
        let packet = DecodedPacket::decode(bytes)?;
        if packet.sequence != expected {
            return Err(ProtocolError::OutOfOrder {
                expected,
                received: packet.sequence,
            });
        }

        // update() validates the entire write set before opening a live mutator.
        // The exclusive borrow keeps input/paint from interleaving its application.
        if let Err(error) = apply(&mut self.document, &packet.writes) {
            if matches!(
                error,
                DocumentError::ApplicationFailed | DocumentError::FailedDocument
            ) {
                self.close();
                return Err(ProtocolError::AcceptanceUnknown);
            }
            return Err(ProtocolError::Refused(error));
        }

        self.next_sequence = (expected < MAX_SAFE_INTEGER).then_some(expected + 1);
        Ok(Acceptance {
            version: PROTOCOL_VERSION,
            sequence: expected,
            status: AcceptanceStatus::Accepted,
        })
    }
}

#[cfg(test)]
mod tests {
    use blitz_dom::DocumentConfig;

    use crate::document::{
        MountTarget, Owner, SourceNode, Template, TemplateNode, ValidatedTemplate,
    };

    use super::*;

    #[test]
    fn ambiguous_application_closes_without_advancing_or_retrying() {
        let mut document = NativeDocument::new(DocumentConfig::default());
        let owner = Owner::new("App", 1);
        let template = ValidatedTemplate::new(Template {
            key: "ambiguous".to_string(),
            nodes: vec![TemplateNode {
                parent: None,
                node: SourceNode::Text("before".to_string()),
            }],
        })
        .unwrap();
        document
            .mount(owner.clone(), &template, MountTarget::Body)
            .unwrap();
        let node = document.node_id(&owner.node(0)).unwrap();
        let mut session = PublicationSession::new(document);
        let packet = br#"{"version":1,"sequence":1,"writes":[{"op":"text","target":{"owner":{"id":"App","generation":1},"source":0},"value":"applied"}]}"#;
        let result = session.publish_with(packet, |document, writes| {
            // Simulate a failure after a real engine write. The protocol must
            // never return an ordinary refusal or pretend the write rolled back.
            document.update(writes)?;
            Err(DocumentError::ApplicationFailed)
        });

        assert_eq!(result, Err(ProtocolError::AcceptanceUnknown));
        assert_eq!(session.next_sequence, Some(1));
        assert!(session.is_closed());
        assert_eq!(
            session
                .document()
                .engine()
                .get_node(node)
                .unwrap()
                .text_content(),
            "applied"
        );
        assert_eq!(session.publish(packet), Err(ProtocolError::Closed));
    }

    #[test]
    fn final_safe_sequence_accepts_once_without_overflow() {
        let mut session = PublicationSession::new(NativeDocument::new(DocumentConfig::default()));
        session.next_sequence = Some(MAX_SAFE_INTEGER);
        let packet = format!(r#"{{"version":1,"sequence":{MAX_SAFE_INTEGER},"writes":[]}}"#);

        assert_eq!(
            session.publish(packet.as_bytes()).unwrap().sequence(),
            MAX_SAFE_INTEGER
        );
        assert_eq!(
            session.publish(packet.as_bytes()),
            Err(ProtocolError::SequenceExhausted)
        );
    }
}
