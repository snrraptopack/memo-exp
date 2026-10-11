//! Authoritative translation from authored tags to native presentation semantics.
//!
//! GPUI's `div()` is a rendering building block, not an HTML tag implementation.
//! The adapter must consume these definitions rather than guess from tag names.
//! Add a tag only with content validation, presentation, input and accessibility
//! behavior; unsupported tags never silently become generic containers.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Layout {
    Block,
    Paragraph,
    Inline,
    Control,
    Input,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Content {
    Flow,
    Phrasing,
    Empty,
    List,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Paragraph,
    Button,
    Heading,
}

#[derive(Debug)]
pub struct Tag {
    pub name: &'static str,
    pub layout: Layout,
    pub content: Content,
    pub role: Option<Role>,
    pub click: bool,
}

pub const DIV: Tag = Tag {
    name: "div",
    layout: Layout::Block,
    content: Content::Flow,
    role: None,
    click: false,
};
pub const P: Tag = Tag {
    name: "p",
    layout: Layout::Paragraph,
    content: Content::Phrasing,
    role: Some(Role::Paragraph),
    click: false,
};
pub const SPAN: Tag = Tag {
    name: "span",
    layout: Layout::Inline,
    content: Content::Phrasing,
    role: None,
    click: false,
};
pub const BUTTON: Tag = Tag {
    name: "button",
    layout: Layout::Control,
    content: Content::Phrasing,
    role: Some(Role::Button),
    click: true,
};

macro_rules! tag {
    ($name:literal, $layout:ident, $content:ident, $role:expr) => {
        Tag {
            name: $name,
            layout: Layout::$layout,
            content: Content::$content,
            role: $role,
            click: false,
        }
    };
}
/// Tags with an implemented native flow/text contract. Names are never inferred.
pub static TAGS: &[Tag] = &[
    tag!("form", Block, Flow, None),
    tag!("article", Block, Flow, None),
    tag!("aside", Block, Flow, None),
    tag!("main", Block, Flow, None),
    tag!("nav", Block, Flow, None),
    tag!("section", Block, Flow, None),
    tag!("header", Block, Flow, None),
    tag!("footer", Block, Flow, None),
    tag!("address", Block, Flow, None),
    tag!("blockquote", Block, Flow, None),
    tag!("figure", Block, Flow, None),
    tag!("figcaption", Block, Flow, None),
    tag!("pre", Paragraph, Phrasing, Some(Role::Paragraph)),
    tag!("h1", Paragraph, Phrasing, Some(Role::Heading)),
    tag!("h2", Paragraph, Phrasing, Some(Role::Heading)),
    tag!("h3", Paragraph, Phrasing, Some(Role::Heading)),
    tag!("h4", Paragraph, Phrasing, Some(Role::Heading)),
    tag!("h5", Paragraph, Phrasing, Some(Role::Heading)),
    tag!("h6", Paragraph, Phrasing, Some(Role::Heading)),
    tag!("b", Inline, Phrasing, None),
    tag!("strong", Inline, Phrasing, None),
    tag!("i", Inline, Phrasing, None),
    tag!("em", Inline, Phrasing, None),
    tag!("cite", Inline, Phrasing, None),
    tag!("dfn", Inline, Phrasing, None),
    tag!("var", Inline, Phrasing, None),
    tag!("code", Inline, Phrasing, None),
    tag!("kbd", Inline, Phrasing, None),
    tag!("samp", Inline, Phrasing, None),
    tag!("abbr", Inline, Phrasing, None),
    tag!("data", Inline, Phrasing, None),
    tag!("time", Inline, Phrasing, None),
    tag!("mark", Inline, Phrasing, None),
    tag!("s", Inline, Phrasing, None),
    tag!("del", Inline, Phrasing, None),
    tag!("u", Inline, Phrasing, None),
    tag!("ins", Inline, Phrasing, None),
    tag!("br", Inline, Empty, None),
    tag!("hr", Block, Empty, None),
    tag!("ul", Block, List, None),
    tag!("ol", Block, List, None),
    tag!("li", Block, Flow, None),
    tag!("dl", Block, Flow, None),
    tag!("dt", Paragraph, Phrasing, Some(Role::Paragraph)),
    tag!("dd", Block, Flow, None),
    tag!("input", Input, Empty, None),
];

/// Recognized HTML names whose native behaviors need their own implementations.
/// This catalogue distinguishes unfinished built-ins from unknown/custom tags.
pub const PENDING: &[&str] = &[
    "html",
    "head",
    "body",
    "base",
    "link",
    "meta",
    "style",
    "title",
    "script",
    "noscript",
    "template",
    "a",
    "area",
    "audio",
    "video",
    "source",
    "track",
    "img",
    "picture",
    "map",
    "canvas",
    "svg",
    "math",
    "iframe",
    "embed",
    "object",
    "param",
    "textarea",
    "select",
    "option",
    "optgroup",
    "label",
    "fieldset",
    "legend",
    "datalist",
    "output",
    "progress",
    "meter",
    "details",
    "summary",
    "dialog",
    "table",
    "caption",
    "colgroup",
    "col",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "th",
    "td",
    "small",
    "sub",
    "sup",
    "q",
    "ruby",
    "rt",
    "rp",
    "bdi",
    "bdo",
    "wbr",
    "search",
    "hgroup",
    "menu",
    "acronym",
    "applet",
    "basefont",
    "big",
    "center",
    "dir",
    "font",
    "frame",
    "frameset",
    "marquee",
    "nobr",
    "noembed",
    "noframes",
    "plaintext",
    "rb",
    "rtc",
    "strike",
    "tt",
    "xmp",
];

/// Native defaults are ordinary CSS declarations, overridden by authored CSS.
pub fn defaults(name: &str) -> &'static [(&'static str, &'static str)] {
    match name {
        "h1" => &[("font-size", "2rem"), ("font-weight", "700")],
        "h2" => &[("font-size", "1.5rem"), ("font-weight", "700")],
        "h3" => &[("font-size", "1.25rem"), ("font-weight", "700")],
        "h4" | "h5" | "h6" | "strong" | "b" => &[("font-weight", "700")],
        "em" | "i" | "cite" | "dfn" | "var" | "address" => &[("font-style", "italic")],
        "code" | "kbd" | "samp" => &[("font-family", "monospace")],
        "pre" => &[("font-family", "monospace"), ("white-space", "pre")],
        "mark" => &[("background-color", "yellow"), ("color", "black")],
        "s" | "del" => &[("text-decoration", "line-through")],
        "u" | "ins" => &[("text-decoration", "underline")],
        "ul" | "ol" | "dd" => &[("padding-left", "24px")],
        "hr" => &[
            ("height", "1px"),
            ("background-color", "#cbd5e1"),
            ("margin-top", "8px"),
            ("margin-bottom", "8px"),
        ],
        "input" => &[
            ("padding", "8px"),
            ("width", "240px"),
            ("min-width", "0"),
            ("border", "1px solid #94a3b8"),
            ("border-radius", "4px"),
            ("background-color", "white"),
            ("cursor", "text"),
        ],
        "button" => &[
            ("padding", "8px 12px"),
            ("background-color", "#e2e8f0"),
            ("border-radius", "4px"),
            ("cursor", "pointer"),
        ],
        _ => &[],
    }
}

/// Prototype aliases remain explicit. They share semantics, not new controls.
pub fn resolve(name: &str) -> Result<&'static Tag, String> {
    match name {
        "div" | "container" => Ok(&DIV),
        "p" => Ok(&P),
        "span" | "text" => Ok(&SPAN),
        "button" => Ok(&BUTTON),
        _ => TAGS.iter().find(|tag| tag.name == name).ok_or_else(|| {
            if PENDING.contains(&name) { format!("Unsupported desktop tag <{name}>: its native behavior is not implemented yet") }
            else { format!("Unsupported desktop tag <{name}>: unknown tag; custom element registration is not implemented") }
        }),
    }
}

impl Tag {
    pub fn accepts(&self, child: Option<&Tag>) -> bool {
        match self.content {
            Content::Flow => true,
            Content::Phrasing => child.is_none_or(|tag| tag.layout == Layout::Inline),
            Content::Empty => false,
            Content::List => child.is_some_and(|tag| tag.name == "li"),
        }
    }
}

/// Attributes supported by the current native renderer. Both static templates
/// and dynamic property transactions use this same capability contract.
pub fn attributes(tag: &Tag) -> Vec<&'static str> {
    let mut names = vec!["class", "id", "style", "title", "aria-label"];
    if matches!(tag.name, "input" | "button") {
        names.push("type");
    }
    if tag.layout == Layout::Input {
        names.extend(["value", "placeholder"]);
    }
    names
}

pub fn supports_event(tag: &Tag, event: crate::template::EventKind) -> bool {
    use crate::template::EventKind;
    match event {
        EventKind::Change => tag.layout == Layout::Input,
        EventKind::Submit => tag.name == "form",
        EventKind::Click | EventKind::PointerDown | EventKind::PointerUp => true,
        _ => tag.layout != Layout::Inline,
    }
}

pub fn validate_attributes(
    tag: &Tag,
    values: &std::collections::BTreeMap<String, String>,
) -> Result<(), String> {
    let allowed = attributes(tag);
    for name in values.keys() {
        if name == "style" || !allowed.contains(&name.as_str()) {
            return Err(format!(
                "Unsupported desktop attribute {name} on <{}>",
                tag.name
            ));
        }
    }
    if tag.layout == Layout::Input && values.get("type").is_some_and(|value| value != "text") {
        return Err("only input type=text is implemented".into());
    }
    Ok(())
}

/// A small checked-in projection lets TypeScript builds run without Cargo.
pub fn capability_projection() -> serde_json::Value {
    use crate::template::EventKind;
    let events = [
        EventKind::Click,
        EventKind::Change,
        EventKind::KeyDown,
        EventKind::KeyUp,
        EventKind::PointerDown,
        EventKind::PointerUp,
        EventKind::Focus,
        EventKind::Blur,
        EventKind::Submit,
    ];
    let mut result = std::collections::BTreeMap::new();
    for tag in [&DIV, &P, &SPAN, &BUTTON].into_iter().chain(TAGS) {
        result.insert(tag.name, serde_json::json!({
            "attributes": attributes(tag),
            "events": events.into_iter().filter(|event| supports_event(tag, *event)).collect::<Vec<_>>(),
        }));
    }
    for (alias, name) in [("container", "div"), ("text", "span")] {
        result.insert(alias, result[name].clone());
    }
    serde_json::json!({ "version": 1, "tags": result })
}

#[cfg(test)]
mod capability_tests {
    #[test]
    fn checked_in_capabilities_match_native_contract() {
        let committed: serde_json::Value =
            serde_json::from_str(include_str!("../../src/scene/capabilities.json")).unwrap();
        assert_eq!(
            committed,
            super::capability_projection(),
            "Run desktop capabilities:generate after changing tags.rs"
        );
    }
}
