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
    "form",
    "input",
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
