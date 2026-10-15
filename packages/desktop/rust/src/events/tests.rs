//! Real Blitz editor, default decisions and framed output; no replacement editor.
use std::io::{self, Cursor, Write};
use std::sync::{Arc, mpsc};
use std::time::Duration;

use blitz_dom::{Attribute, DocumentConfig, QualName, ns};
use blitz_traits::events::{
    BlitzImeEvent, BlitzKeyEvent, BlitzPointerEvent, BlitzPointerId, KeyState, MouseEventButton,
    MouseEventButtons, Point, PointerCoords, PointerDetails, UiEvent,
};
use keyboard_types::{Code, Key, Location, Modifiers};
use serde_json::{Value, json};

use super::{PendingDefaults, wire::DispatchDecision};
use crate::document::{
    MountTarget, Mutation, NativeDocument, Owner, SourceNode, Template, TemplateNode,
    ValidatedTemplate, html_name,
};
use crate::protocol::{EventSink, FrameReader, ProcessDriver, PublicationSession};

struct PacketWriter {
    bytes: Vec<u8>,
    output: mpsc::Sender<Vec<u8>>,
}

impl Write for PacketWriter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        self.output
            .send(std::mem::take(&mut self.bytes))
            .map_err(|_| io::Error::from(io::ErrorKind::BrokenPipe))?;
        Ok(())
    }
}

struct Fixture {
    doc: NativeDocument,
    source: crate::document::NodeRef,
    defaults: PendingDefaults,
    sink: EventSink,
    packets: mpsc::Receiver<Vec<u8>>,
    _driver: ProcessDriver,
    control_version: u64,
}

impl Fixture {
    fn new() -> Self {
        let mut doc = NativeDocument::new(DocumentConfig::default());
        let template = ValidatedTemplate::new(Template {
            key: "editor".into(),
            nodes: vec![
                TemplateNode {
                    parent: None,
                    node: SourceNode::Element {
                        name: html_name("input"),
                        attributes: vec![],
                    },
                },
                TemplateNode {
                    parent: None,
                    node: SourceNode::Element {
                        name: html_name("button"),
                        attributes: vec![Attribute {
                            name: QualName::new(None, ns!(), "style".into()),
                            value: "display:block;width:100px;height:40px".into(),
                        }],
                    },
                },
            ],
        })
        .unwrap();
        let owner = Owner::new("Editor", 1);
        doc.mount(owner.clone(), &template, MountTarget::Body)
            .unwrap();
        doc.resolve(0.0).unwrap();
        let source = owner.node(0);
        let node = doc.node_id(&source).unwrap();
        doc.engine_mut().set_focus_to(node);
        let (output, packets) = mpsc::channel();
        let driver = ProcessDriver::start(
            PublicationSession::new(NativeDocument::new(DocumentConfig::default())),
            io::empty(),
            PacketWriter {
                bytes: vec![],
                output,
            },
            Arc::new(|| {}),
        )
        .unwrap();
        let sink = driver.event_sink();
        let mut defaults = PendingDefaults::new();
        defaults.scene_sequence = 1;
        Self {
            doc,
            source,
            defaults,
            sink,
            packets,
            _driver: driver,
            control_version: 0,
        }
    }

    fn key(&mut self, key: Key) {
        let text = match &key {
            Key::Character(text) => Some(text.as_str().into()),
            _ => None,
        };
        self.defaults.handle_ui_event(
            &mut self.doc,
            UiEvent::KeyDown(BlitzKeyEvent {
                key,
                code: Code::Unidentified,
                location: Location::Standard,
                modifiers: Modifiers::empty(),
                is_auto_repeating: false,
                is_composing: false,
                state: KeyState::Pressed,
                text,
            }),
            &self.sink,
        );
    }

    fn packet(&self) -> Value {
        let bytes = self.packets.recv_timeout(Duration::from_secs(5)).unwrap();
        let body = FrameReader::new(Cursor::new(bytes))
            .read_packet()
            .unwrap()
            .unwrap();
        serde_json::from_slice(&body).unwrap()
    }

    fn click_button(&mut self) {
        let node = self.doc.node_id(&self.source.owner.node(1)).unwrap();
        let rect = self.doc.engine().get_client_bounding_rect(node).unwrap();
        let x = rect.x as f32 + 10.0;
        let y = rect.y as f32 + 10.0;
        let pointer = BlitzPointerEvent {
            id: BlitzPointerId::Mouse,
            is_primary: true,
            coords: PointerCoords {
                page_x: x,
                page_y: y,
                client_x: x,
                client_y: y,
                screen_x: x,
                screen_y: y,
            },
            button: MouseEventButton::Main,
            buttons: MouseEventButtons::Primary,
            mods: Modifiers::empty(),
            details: PointerDetails::default(),
            element: Point::default(),
            active_pointers: Default::default(),
        };
        self.defaults.handle_ui_event(
            &mut self.doc,
            UiEvent::PointerDown(pointer.clone()),
            &self.sink,
        );
        self.defaults.handle_ui_event(
            &mut self.doc,
            UiEvent::PointerUp(BlitzPointerEvent {
                buttons: MouseEventButtons::default(),
                ..pointer
            }),
            &self.sink,
        );
    }

    fn decide(&mut self, packet: &Value, cancelled: bool) {
        self.decide_with_controls(packet, cancelled, json!([]));
    }

    fn decide_with_controls(&mut self, packet: &Value, cancelled: bool, controls: Value) {
        let decision: DispatchDecision = serde_json::from_value(json!({
            "kind":"dispatchResult", "version":1,
            "dispatchId":packet["dispatchId"], "cancelled":cancelled, "controls":controls,
        }))
        .unwrap();
        self.defaults
            .decide(&mut self.doc, decision, &self.sink)
            .unwrap();
    }

    fn value(&self) -> String {
        self.doc
            .control_state(self.doc.node_id(&self.source).unwrap())
            .unwrap()
            .value
    }

    fn write(&mut self, value: &str, revision: u64) {
        self.control_version += 1;
        self.doc
            .update(&[Mutation::Value {
                target: self.source.clone(),
                value: value.into(),
                revision,
                version: self.control_version,
            }])
            .unwrap();
    }
}

#[test]
fn controlled_clear_precedes_a_queued_key_even_without_scene_publication() {
    let mut fixture = Fixture::new();
    fixture.key(Key::Character("a".into()));
    let key = fixture.packet();
    fixture.decide(&key, false);
    let input = fixture.packet();
    fixture.decide(&input, false);
    fixture.key(Key::Enter);
    fixture.key(Key::Character("b".into()));
    let enter = fixture.packet();
    fixture.decide_with_controls(
        &enter,
        true,
        json!([{
            "op":"setValue", "target":fixture.source, "value":"", "revision":1, "version":10,
        }]),
    );
    let next = fixture.packet();
    assert_eq!(next["keyboard"]["key"], "b");
    assert_eq!(next["control"]["value"], "");
    fixture.decide(&next, false);
    let input = fixture.packet();
    assert_eq!(input["control"]["value"], "b");
    fixture.decide(&input, false);
}

#[test]
fn an_older_queued_render_cannot_restore_a_value_cleared_by_dispatch() {
    let mut fixture = Fixture::new();
    fixture.key(Key::Character("a".into()));
    let key = fixture.packet();
    fixture.decide(&key, false);
    let input = fixture.packet();
    fixture.decide_with_controls(
        &input,
        false,
        json!([{
            "op":"setValue", "target":fixture.source, "value":"", "revision":1, "version":10,
        }]),
    );
    assert_eq!(fixture.value(), "");
    fixture.write("older queued render", 1);
    assert_eq!(fixture.value(), "");
}

#[test]
fn queued_keys_publish_each_edit_before_enter_and_cancel_without_replay() {
    let mut fixture = Fixture::new();
    fixture.key(Key::Character("a".into()));
    fixture.key(Key::Character("b".into()));
    fixture.key(Key::Enter);
    let first = fixture.packet();
    assert_eq!(first["eventType"], "keydown");
    assert_eq!(fixture.value(), "");
    assert!(fixture.packets.try_recv().is_err());

    fixture.decide(&first, false);
    let input_a = fixture.packet();
    assert_eq!(input_a["eventType"], "input");
    assert_eq!(input_a["control"]["value"], "a");
    assert_eq!(input_a["control"]["revision"], 1);
    assert_eq!(input_a["cancelable"], false);
    fixture.decide(&input_a, true); // Notification cancellation cannot undo editing.

    let second = fixture.packet();
    assert_eq!(second["keyboard"]["key"], "b");
    assert_eq!(second["control"]["value"], "a");
    fixture.decide(&second, false);
    let input_ab = fixture.packet();
    assert_eq!(input_ab["control"]["value"], "ab");
    assert_eq!(input_ab["control"]["revision"], 2);
    fixture.decide(&input_ab, false);

    let enter = fixture.packet();
    assert_eq!(enter["keyboard"]["key"], "Enter");
    assert_eq!(enter["control"]["value"], "ab");
    fixture.decide(&enter, true);
    assert_eq!(fixture.value(), "ab");
    fixture.write("", 2);
    assert_eq!(fixture.value(), "");
    assert!(fixture.packets.try_recv().is_err());
}

#[test]
fn cancelled_key_and_stale_controlled_values_cannot_replace_newer_typing() {
    let mut fixture = Fixture::new();
    fixture.key(Key::Character("x".into()));
    let key = fixture.packet();
    fixture.decide(&key, true);
    assert_eq!(fixture.value(), "");
    fixture.key(Key::Character("y".into()));
    let key = fixture.packet();
    fixture.decide(&key, false);
    let input = fixture.packet();
    fixture.write("old render", 0);
    assert_eq!(fixture.value(), "y");
    fixture.write("accepted", 1);
    assert_eq!(fixture.value(), "accepted");
    fixture.decide(&input, false);
    assert!(fixture.packets.try_recv().is_err());
}

#[test]
fn ime_preedit_stays_native_and_only_committed_text_notifies_script() {
    let mut fixture = Fixture::new();
    fixture.defaults.handle_ui_event(
        &mut fixture.doc,
        UiEvent::Ime(BlitzImeEvent::Preedit("ni".into(), Some((2, 2)))),
        &fixture.sink,
    );
    assert!(fixture.packets.try_recv().is_err());
    fixture.write("stale", 0);
    let before = fixture.value();
    assert_ne!(before, "stale");
    // Winit's IME contract clears preedit immediately before the commit.
    fixture.defaults.handle_ui_event(
        &mut fixture.doc,
        UiEvent::Ime(BlitzImeEvent::Preedit(String::new(), None)),
        &fixture.sink,
    );
    fixture.defaults.handle_ui_event(
        &mut fixture.doc,
        UiEvent::Ime(BlitzImeEvent::Commit("你".into())),
        &fixture.sink,
    );
    let input = fixture.packet();
    assert_eq!(input["eventType"], "input");
    assert_eq!(input["control"]["value"], "你");
    assert_eq!(input["control"]["isComposing"], false);
    fixture.decide(&input, false);
    assert_eq!(fixture.value(), "你");
}

#[test]
fn matching_value_echo_keeps_the_native_caret_position() {
    let mut fixture = Fixture::new();
    fixture.key(Key::Character("a".into()));
    let key = fixture.packet();
    fixture.decide(&key, false);
    let input = fixture.packet();
    fixture.decide(&input, false);
    fixture.key(Key::ArrowLeft);
    let left = fixture.packet();
    fixture.decide(&left, false);
    fixture.write("a", 1);
    fixture.key(Key::Character("b".into()));
    let key = fixture.packet();
    fixture.decide(&key, false);
    let input = fixture.packet();
    assert_eq!(input["control"]["value"], "ba");
    fixture.decide(&input, false);
}

#[test]
fn retiring_a_control_discards_held_keys_instead_of_redirecting_them() {
    let mut fixture = Fixture::new();
    fixture.key(Key::Character("a".into()));
    fixture.key(Key::Character("b".into()));
    let first = fixture.packet();
    fixture.doc.retire(&fixture.source.owner).unwrap();
    fixture.decide(&first, false);
    assert!(fixture.packets.try_recv().is_err());
    assert!(fixture.defaults.next_deadline().is_none());
}

#[test]
fn excessive_queued_input_fails_explicitly_instead_of_dropping_characters() {
    let mut fixture = Fixture::new();
    for _ in 0..9 {
        fixture.key(Key::Character("a".into()));
    }
    let _first = fixture.packet();
    assert_eq!(
        fixture.defaults.check_failure().unwrap_err().code,
        "dispatchQueueFull"
    );
}

#[test]
fn clicking_add_after_a_key_keeps_the_last_character_before_focus_moves() {
    let mut fixture = Fixture::new();
    fixture.key(Key::Character("a".into()));
    fixture.click_button();
    let key = fixture.packet();
    fixture.decide(&key, false);
    let input = fixture.packet();
    assert_eq!(input["eventType"], "input");
    assert_eq!(input["control"]["value"], "a");
    fixture.decide(&input, false);
    let click = fixture.packet();
    assert_eq!(click["eventType"], "click");
    assert_eq!(click["path"][0]["source"], 1);
    assert_eq!(fixture.value(), "a");
    fixture.decide(&click, true);
}
