//! CSS property adapter to GPUI's own StyleRefinement. GPUI owns Taffy layout.
use cssparser::{Parser, ParserInput, ToCss, Token};
use gpui::{
    AbsoluteLength, AlignContent, AlignItems, BorderStyle, CursorStyle, DefiniteLength, Display,
    FlexDirection, FlexWrap, FontStyle, FontWeight, GridTemplate, GridTemplateMinSize, Hsla,
    Length, Overflow, Position, Rgba, StrikethroughStyle, StyleRefinement, TextAlign, TextStyle,
    TextStyleRefinement, UnderlineStyle, WhiteSpace, px, relative, rems,
};
use memoized_dom_desktop_host::{
    css::{self, CascadedStyle, Declaration, Properties},
    tags,
    template::{Node, PreparedTemplate},
};
use std::{collections::BTreeMap, sync::Arc};

pub struct NativeStyles {
    pub nodes: Vec<[StyleRefinement; 4]>,
    pub current_color: Vec<[bool; 4]>,
}
pub struct CachedStyles {
    pub cascade: Arc<Vec<CascadedStyle>>,
    pub native: Arc<NativeStyles>,
}
pub type StyleCache = BTreeMap<(u64, u64), CachedStyles>;

pub fn prepare(template: &PreparedTemplate) -> Result<NativeStyles, String> {
    prepare_cascade(template, &template.styles)
}

pub fn prepare_cascade(
    template: &PreparedTemplate,
    cascade: &[CascadedStyle],
) -> Result<NativeStyles, String> {
    let mut nodes = Vec::new();
    let mut current_color = Vec::new();
    for (index, node) in template.source.nodes.iter().enumerate() {
        let Node::Element { tag, .. } = node else {
            nodes.push(std::array::from_fn(|_| StyleRefinement::default()));
            current_color.push([false; 4]);
            continue;
        };
        let semantics = tags::resolve(tag)?;
        let defaults = css::expand_declarations(
            &tags::defaults(tag)
                .iter()
                .map(|&(property, value)| Declaration {
                    property: property.into(),
                    value: value.into(),
                })
                .collect::<Vec<_>>(),
        )?;
        let mut states = std::array::from_fn(|_| StyleRefinement::default());
        let mut inherited_border = [false; 4];
        for (state, style) in states.iter_mut().enumerate() {
            let mut properties = defaults.clone();
            properties.extend(cascade[index].states[state].clone());
            inherited_border[state] = properties
                .get("border-color")
                .is_some_and(|value| value.eq_ignore_ascii_case("currentcolor"));
            if semantics.layout == tags::Layout::Inline {
                for property in properties.keys() {
                    if !matches!(
                        property.as_str(),
                        "color"
                            | "background-color"
                            | "font-weight"
                            | "font-style"
                            | "font-family"
                            | "text-decoration"
                            | "text-decoration-color"
                    ) {
                        return Err(format!(
                            "CSS {property} on inline <{tag}> requires inline box/size support"
                        ));
                    }
                }
                if state > 0 && cascade[index].states[state] != cascade[index].states[0] {
                    return Err(format!(
                        "CSS interaction styles on inline <{tag}> require inline hitboxes"
                    ));
                }
            } else {
                style.display = Some(Display::Block);
            }
            adapt(style, &properties).map_err(|error| {
                format!(
                    "Desktop template {}, node {index} <{tag}>: {error}",
                    template.source.id
                )
            })?;
            if semantics.layout == tags::Layout::Inline
                && let Some(background) = properties.get("background-color")
            {
                style.text.background_color = Some(color(background)?);
                style.background = None;
            }
        }
        nodes.push(states);
        current_color.push(inherited_border);
    }
    Ok(NativeStyles {
        nodes,
        current_color,
    })
}

pub fn apply_text(style: &mut TextStyle, refinement: &TextStyleRefinement) {
    if let Some(color) = refinement.color {
        style.color = color;
    }
    if let Some(family) = &refinement.font_family {
        style.font_family = family.clone();
    }
    if let Some(weight) = refinement.font_weight {
        style.font_weight = weight;
    }
    if let Some(font_style) = refinement.font_style {
        style.font_style = font_style;
    }
    if let Some(background) = refinement.background_color {
        style.background_color = Some(background);
    }
    if let Some(underline) = refinement.underline {
        style.underline = Some(underline);
    }
    if let Some(strikethrough) = refinement.strikethrough {
        style.strikethrough = Some(strikethrough);
    }
}

fn length(value: &str) -> Result<Length, String> {
    let mut source = ParserInput::new(value);
    let mut input = Parser::new(&mut source);
    let token = input
        .next()
        .map_err(|_| format!("Invalid CSS length: {value}"))?
        .clone();
    let result = match token {
        Token::Ident(ref name) if name.eq_ignore_ascii_case("auto") => Length::Auto,
        Token::Number { value: 0., .. } => px(0.).into(),
        Token::Dimension {
            value, ref unit, ..
        } if value.is_finite() && unit.eq_ignore_ascii_case("px") => px(value).into(),
        Token::Dimension {
            value, ref unit, ..
        } if value.is_finite() && unit.eq_ignore_ascii_case("rem") => rems(value).into(),
        Token::Percentage { unit_value, .. } if unit_value.is_finite() => {
            relative(unit_value).into()
        }
        _ => {
            return Err(format!(
                "CSS length {value} is not supported by this GPUI adapter (use px, rem, %, 0 or auto)"
            ));
        }
    };
    input
        .expect_exhausted()
        .map_err(|_| format!("Invalid CSS length: {value}"))?;
    Ok(result)
}
fn definite(value: &str) -> Result<DefiniteLength, String> {
    match length(value)? {
        Length::Definite(value) => Ok(value),
        _ => Err(format!("auto is invalid here: {value}")),
    }
}
fn absolute(value: &str) -> Result<AbsoluteLength, String> {
    match positive(value)? {
        DefiniteLength::Absolute(value) => Ok(value),
        _ => Err(format!("Percentage is invalid here: {value}")),
    }
}
fn positive(value: &str) -> Result<DefiniteLength, String> {
    let parsed = definite(value)?;
    let negative = match parsed {
        DefiniteLength::Fraction(value) => value < 0.,
        DefiniteLength::Absolute(AbsoluteLength::Pixels(value)) => value.as_f32() < 0.,
        DefiniteLength::Absolute(AbsoluteLength::Rems(value)) => value.0 < 0.,
    };
    if negative {
        Err(format!("Negative CSS value: {value}"))
    } else {
        Ok(parsed)
    }
}
fn number(value: &str) -> Result<f32, String> {
    value
        .parse::<f32>()
        .ok()
        .filter(|value| value.is_finite())
        .ok_or_else(|| format!("Invalid CSS number: {value}"))
}
fn color(value: &str) -> Result<Hsla, String> {
    let color: csscolorparser::Color = value
        .parse()
        .map_err(|_| format!("Invalid/unsupported CSS color: {value}"))?;
    let [r, g, b, a] = color.to_array();
    Ok(Rgba { r, g, b, a }.into())
}
fn alignment(value: &str) -> Result<AlignItems, String> {
    // Taffy's parser validates the CSS keyword and rejects unrepresented safe/unsafe forms.
    let _ = value
        .parse::<taffy::AlignItems>()
        .map_err(|e| e.to_string())?;
    match value {
        "start" => Ok(AlignItems::Start),
        "end" => Ok(AlignItems::End),
        "flex-start" => Ok(AlignItems::FlexStart),
        "flex-end" => Ok(AlignItems::FlexEnd),
        "center" => Ok(AlignItems::Center),
        "baseline" => Ok(AlignItems::Baseline),
        "stretch" => Ok(AlignItems::Stretch),
        _ => Err(format!("GPUI alignment {value} is not represented")),
    }
}
fn distribution(value: &str) -> Result<AlignContent, String> {
    let _ = value
        .parse::<taffy::AlignContent>()
        .map_err(|e| e.to_string())?;
    match value {
        "start" => Ok(AlignContent::Start),
        "end" => Ok(AlignContent::End),
        "flex-start" => Ok(AlignContent::FlexStart),
        "flex-end" => Ok(AlignContent::FlexEnd),
        "center" => Ok(AlignContent::Center),
        "stretch" => Ok(AlignContent::Stretch),
        "space-between" => Ok(AlignContent::SpaceBetween),
        "space-around" => Ok(AlignContent::SpaceAround),
        "space-evenly" => Ok(AlignContent::SpaceEvenly),
        _ => Err(format!("GPUI distribution {value} is not represented")),
    }
}
fn grid(value: &str) -> Result<GridTemplate, String> {
    type Tracks = taffy::GridTemplateTracks<String, taffy::GridTemplateComponent<String>>;
    // Taffy 0.13's track parser accepts 0px but rejects CSS's unitless zero.
    // Normalize CSS Syntax tokens before delegating the complete track grammar.
    fn normalize(input: &mut Parser<'_, '_>) -> Result<String, String> {
        let mut output = Vec::new();
        while !input.is_exhausted() {
            let token = input
                .next()
                .map_err(|e| format!("Invalid grid CSS: {e:?}"))?
                .clone();
            let text = if let Token::Function(_) = token {
                let content = input
                    .parse_nested_block::<_, _, ()>(|nested| {
                        normalize(nested).map_err(|_| nested.new_custom_error(()))
                    })
                    .map_err(|e| format!("Invalid grid function: {e:?}"))?;
                format!("{}{content})", token.to_css_string())
            } else if matches!(token, Token::Number { value: 0., .. }) {
                "0px".into()
            } else {
                token.to_css_string()
            };
            output.push(text);
        }
        Ok(output.join(" "))
    }
    let mut source = ParserInput::new(value);
    let normalized = normalize(&mut Parser::new(&mut source))?;
    let parsed: Tracks = normalized
        .parse()
        .map_err(|e: taffy::ParseError| e.to_string())?;
    // GPUI exposes equal repeated tracks. Validate the actual syntax with Taffy,
    // then require an exactly representable track plan; arbitrary tracks fail.
    for count in 1..=64 {
        for (track, min_size) in [
            ("1fr", GridTemplateMinSize::MinContent),
            ("minmax(0px, 1fr)", GridTemplateMinSize::Zero),
        ] {
            for candidate in [
                format!("repeat({count}, {track})"),
                vec![track; count].join(" "),
            ] {
                if parsed == candidate.parse::<Tracks>().unwrap() {
                    return Ok(GridTemplate {
                        repeat: count as _,
                        min_size,
                    });
                }
            }
        }
    }
    Err(format!(
        "CSS grid tracks {value} exceed GPUI's current grid representation"
    ))
}

pub fn adapt(style: &mut StyleRefinement, properties: &Properties) -> Result<(), String> {
    for (property, value) in properties {
        let value = value.as_str();
        if value == "inherit"
            && matches!(
                property.as_str(),
                "color"
                    | "font-family"
                    | "font-size"
                    | "font-weight"
                    | "font-style"
                    | "line-height"
                    | "text-align"
                    | "white-space"
            )
        {
            continue;
        }
        match property.as_str() {
            "display" => {
                style.display = Some(
                    match value.parse::<taffy::Display>().map_err(|e| e.to_string())? {
                        taffy::Display::Block => Display::Block,
                        taffy::Display::Flex => Display::Flex,
                        taffy::Display::Grid => Display::Grid,
                        taffy::Display::None => Display::None,
                        _ => return Err(format!("GPUI display {value} is not represented")),
                    },
                );
            }
            "width" => style.size.width = Some(length(value)?),
            "height" => style.size.height = Some(length(value)?),
            "min-width" => style.min_size.width = Some(length(value)?),
            "min-height" => style.min_size.height = Some(length(value)?),
            "max-width" => style.max_size.width = Some(length(value)?),
            "max-height" => style.max_size.height = Some(length(value)?),
            "margin-top" => style.margin.top = Some(length(value)?),
            "margin-right" => style.margin.right = Some(length(value)?),
            "margin-bottom" => style.margin.bottom = Some(length(value)?),
            "margin-left" => style.margin.left = Some(length(value)?),
            "padding-top" => style.padding.top = Some(positive(value)?),
            "padding-right" => style.padding.right = Some(positive(value)?),
            "padding-bottom" => style.padding.bottom = Some(positive(value)?),
            "padding-left" => style.padding.left = Some(positive(value)?),
            "row-gap" => style.gap.height = Some(positive(value)?),
            "column-gap" => style.gap.width = Some(positive(value)?),
            "flex-basis" => style.flex_basis = Some(length(value)?),
            "flex-grow" => {
                let n = number(value)?;
                if n < 0. {
                    return Err("Negative flex-grow".into());
                }
                style.flex_grow = Some(n);
            }
            "flex-shrink" => {
                let n = number(value)?;
                if n < 0. {
                    return Err("Negative flex-shrink".into());
                }
                style.flex_shrink = Some(n);
            }
            "flex-direction" => {
                style.flex_direction = Some(
                    match value
                        .parse::<taffy::FlexDirection>()
                        .map_err(|e| e.to_string())?
                    {
                        taffy::FlexDirection::Row => FlexDirection::Row,
                        taffy::FlexDirection::Column => FlexDirection::Column,
                        taffy::FlexDirection::RowReverse => FlexDirection::RowReverse,
                        taffy::FlexDirection::ColumnReverse => FlexDirection::ColumnReverse,
                    },
                )
            }
            "flex-wrap" => {
                style.flex_wrap = Some(
                    match value
                        .parse::<taffy::FlexWrap>()
                        .map_err(|e| e.to_string())?
                    {
                        taffy::FlexWrap::NoWrap => FlexWrap::NoWrap,
                        taffy::FlexWrap::Wrap => FlexWrap::Wrap,
                        taffy::FlexWrap::WrapReverse => FlexWrap::WrapReverse,
                    },
                )
            }
            "align-items" => style.align_items = Some(alignment(value)?),
            "align-self" => {
                style.align_self = if value == "auto" {
                    None
                } else {
                    Some(alignment(value)?)
                }
            }
            "align-content" => style.align_content = Some(distribution(value)?),
            "justify-content" => style.justify_content = Some(distribution(value)?),
            "position" => {
                style.position = Some(
                    match value
                        .parse::<taffy::Position>()
                        .map_err(|e| e.to_string())?
                    {
                        taffy::Position::Relative => Position::Relative,
                        taffy::Position::Absolute => Position::Absolute,
                    },
                )
            }
            "top" => style.inset.top = Some(length(value)?),
            "right" => style.inset.right = Some(length(value)?),
            "bottom" => style.inset.bottom = Some(length(value)?),
            "left" => style.inset.left = Some(length(value)?),
            "overflow" | "overflow-x" | "overflow-y" => {
                let overflow = match value
                    .parse::<taffy::Overflow>()
                    .map_err(|e| e.to_string())?
                {
                    taffy::Overflow::Visible => Overflow::Visible,
                    taffy::Overflow::Hidden => Overflow::Hidden,
                    taffy::Overflow::Scroll => Overflow::Scroll,
                    taffy::Overflow::Clip => Overflow::Clip,
                };
                if property != "overflow-y" {
                    style.overflow.x = Some(overflow);
                }
                if property != "overflow-x" {
                    style.overflow.y = Some(overflow);
                }
            }
            "grid-template-columns" => style.grid_cols = Some(grid(value)?),
            "grid-template-rows" => style.grid_rows = Some(grid(value)?),
            "background-color" => style.background = Some(color(value)?.into()),
            // Resolved against the effective inherited text color during layout.
            "border-color" if value.eq_ignore_ascii_case("currentcolor") => {}
            "border-color" => style.border_color = Some(color(value)?),
            "border-style" => {
                style.border_style = Some(match value {
                    "solid" => BorderStyle::Solid,
                    "dashed" => BorderStyle::Dashed,
                    _ => return Err(format!("Unsupported border style {value}")),
                })
            }
            "border-top-width"
            | "border-right-width"
            | "border-bottom-width"
            | "border-left-width" => {
                let value = absolute(match value {
                    "thin" => "1px",
                    "medium" => "3px",
                    "thick" => "5px",
                    _ => value,
                })?;
                match property.as_str() {
                    "border-top-width" => style.border_widths.top = Some(value),
                    "border-right-width" => style.border_widths.right = Some(value),
                    "border-bottom-width" => style.border_widths.bottom = Some(value),
                    _ => style.border_widths.left = Some(value),
                }
            }
            "border-top-left-radius" => style.corner_radii.top_left = Some(absolute(value)?),
            "border-top-right-radius" => style.corner_radii.top_right = Some(absolute(value)?),
            "border-bottom-left-radius" => style.corner_radii.bottom_left = Some(absolute(value)?),
            "border-bottom-right-radius" => {
                style.corner_radii.bottom_right = Some(absolute(value)?)
            }
            "color" => style.text.color = Some(color(value)?),
            "font-size" => style.text.font_size = Some(absolute(value)?),
            "font-family" => {
                let parts = css::components(value)?;
                if parts.len() != 1 {
                    return Err("CSS font-family lists are not implemented".into());
                }
                let mut source = ParserInput::new(value);
                let mut input = Parser::new(&mut source);
                let family = input
                    .expect_ident_or_string()
                    .map_err(|_| "Invalid font-family")?
                    .to_string();
                style.text.font_family = Some(match family.as_str() {
                    "monospace" => "Consolas".into(),
                    "sans-serif" | "system-ui" => "Segoe UI".into(),
                    "serif" => "Times New Roman".into(),
                    _ => family.into(),
                });
            }
            "font-weight" => {
                let weight = match value {
                    "normal" => 400.,
                    "bold" => 700.,
                    _ => number(value)?,
                };
                if !(1. ..=1000.).contains(&weight) {
                    return Err("Invalid font-weight".into());
                }
                style.text.font_weight = Some(FontWeight(weight));
            }
            "font-style" => {
                style.text.font_style = Some(match value {
                    "normal" => FontStyle::Normal,
                    "italic" => FontStyle::Italic,
                    _ => return Err(format!("Unsupported font-style {value}")),
                })
            }
            "line-height" => {
                style.text.line_height = Some(if let Ok(n) = number(value) {
                    if n < 0. {
                        return Err("Negative line-height".into());
                    }
                    relative(n)
                } else {
                    positive(value)?
                })
            }
            "white-space" => {
                style.text.white_space = Some(match value {
                    "normal" | "pre-wrap" => WhiteSpace::Normal,
                    "nowrap" | "pre" => WhiteSpace::Nowrap,
                    _ => return Err(format!("Unsupported white-space {value}")),
                })
            }
            "text-align" => {
                style.text.text_align = Some(match value {
                    "left" | "start" => TextAlign::Left,
                    "center" => TextAlign::Center,
                    "right" | "end" => TextAlign::Right,
                    _ => return Err(format!("Unsupported text-align {value}")),
                })
            }
            "text-decoration" => {
                if !matches!(value, "none" | "underline" | "line-through") {
                    return Err(format!("Unsupported text-decoration {value}"));
                }
                style.text.underline = if value == "underline" {
                    Some(UnderlineStyle {
                        thickness: px(1.),
                        color: None,
                        wavy: false,
                    })
                } else {
                    None
                };
                style.text.strikethrough = if value == "line-through" {
                    Some(StrikethroughStyle {
                        thickness: px(1.),
                        color: None,
                    })
                } else {
                    None
                };
            }
            "opacity" => {
                let opacity = number(value)?;
                if !(0. ..=1.).contains(&opacity) {
                    return Err("Invalid opacity".into());
                }
                style.opacity = Some(opacity);
            }
            "cursor" => {
                style.mouse_cursor = Some(match value {
                    "pointer" => CursorStyle::PointingHand,
                    "default" | "auto" => CursorStyle::Arrow,
                    "text" => CursorStyle::IBeam,
                    _ => return Err(format!("Unsupported cursor {value}")),
                })
            }
            _ => {
                return Err(format!(
                    "CSS property {property} is not represented by this GPUI adapter"
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::rgb;
    use serde_json::json;

    #[test]
    fn css_maps_to_gpui_layout_and_visual_fields() {
        let properties = [
            ("display", "flex"),
            ("flex-direction", "column"),
            ("width", "75%"),
            ("padding-top", "12px"),
            ("row-gap", "8px"),
            ("color", "rgb(255, 0, 0)"),
            ("background-color", "#123456"),
            ("font-weight", "600"),
            ("line-height", "1.5"),
        ]
        .into_iter()
        .map(|(p, v)| (p.into(), v.into()))
        .collect();
        let mut style = StyleRefinement::default();
        adapt(&mut style, &properties).unwrap();
        assert_eq!(style.display, Some(Display::Flex));
        assert_eq!(style.flex_direction, Some(FlexDirection::Column));
        assert_eq!(style.size.width, Some(relative(0.75).into()));
        assert_eq!(style.padding.top, Some(px(12.).into()));
        assert_eq!(style.text.color, Some(rgb(0xff0000).into()));
        assert_eq!(style.text.font_weight, Some(FontWeight(600.)));
        assert!(style.background.is_some());
        assert_eq!(style.text.line_height, Some(relative(1.5)));
    }
    #[test]
    fn grid_uses_taffy_parsing_and_rejects_unrepresented_tracks() {
        assert_eq!(
            grid("repeat(2, minmax(0, 1fr))").unwrap(),
            GridTemplate {
                repeat: 2,
                min_size: GridTemplateMinSize::Zero
            }
        );
        assert_eq!(
            grid("1fr 1fr 1fr").unwrap(),
            GridTemplate {
                repeat: 3,
                min_size: GridTemplateMinSize::MinContent
            }
        );
        assert!(grid("120px 1fr").is_err());
        assert!(grid("invalid(").is_err());
    }
    #[test]
    fn invalid_values_and_properties_fail_native_preparation() {
        for (property, value) in [
            ("font-size", "-2px"),
            ("padding-top", "-1px"),
            ("opacity", "2"),
            ("width", "banana"),
            ("background-image", "url(x)"),
            ("color", "banana"),
        ] {
            assert!(
                adapt(
                    &mut StyleRefinement::default(),
                    &[(property.into(), value.into())].into_iter().collect()
                )
                .is_err(),
                "{property}: {value}"
            );
        }
    }
    #[test]
    fn authored_css_overrides_native_defaults_and_inline_styles_become_text_runs() {
        let template:memoized_dom_desktop_host::Template=serde_json::from_value(json!({"id":"styled","nodes":[
            {"kind":"element","tag":"p","parent":null,"text":""},
            {"kind":"element","tag":"strong","parent":0,"text":"","style":[{"property":"font-weight","value":"400"},{"property":"background-color","value":"yellow"}]},
            {"kind":"text","parent":1,"text":"静🙂"}
        ],"slots":[],"events":[]})).unwrap();
        let prepared = prepare(&template.prepare().unwrap()).unwrap();
        let inline = &prepared.nodes[1][0];
        assert_eq!(inline.text.font_weight, Some(FontWeight(400.)));
        assert!(inline.background.is_none());
        assert!(inline.text.background_color.is_some());
        assert!(inline.display.is_none());
    }
}
