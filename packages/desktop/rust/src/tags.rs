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
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Role {
    Paragraph,
    Button,
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

/// Prototype aliases remain explicit. They share semantics, not new controls.
pub fn resolve(name: &str) -> Result<&'static Tag, String> {
    match name {
        "div" | "container" => Ok(&DIV),
        "p" => Ok(&P),
        "span" | "text" => Ok(&SPAN),
        "button" => Ok(&BUTTON),
        _ => Err(format!("Unsupported desktop tag <{name}>")),
    }
}

impl Tag {
    pub fn accepts(&self, child: Option<&Tag>) -> bool {
        self.content == Content::Flow || child.is_none_or(|tag| tag.layout == Layout::Inline)
    }
}
