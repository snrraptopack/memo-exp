//! Resolve authored CSS against retained source nodes; GPUI/Taffy own styles.
use crate::template::Node;
use cssparser::{Parser, ParserInput, ToCss, Token};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Declaration {
    pub property: String,
    pub value: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Rule {
    pub selectors: Vec<Vec<Selector>>,
    pub declarations: Vec<Declaration>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Selector {
    pub combinator: Option<String>,
    pub selectors: Vec<SimpleSelector>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
pub enum SimpleSelector {
    Tag { name: String },
    Class { name: String },
    Id { name: String },
    State { name: String },
    Scope { name: String },
}
pub type Properties = BTreeMap<String, String>;
#[derive(Clone, Debug, Serialize)]
pub struct CascadedStyle {
    pub states: [Properties; 4],
}
type Priority = (bool, [usize; 4], usize);
type Expanded = Vec<(String, String)>;

pub fn expand_declarations(declarations: &[Declaration]) -> Result<Properties, String> {
    let mut properties = Properties::new();
    for declaration in declarations {
        properties.extend(expand(declaration)?.0);
    }
    Ok(properties)
}

/// Tokenize values using the same CSS Syntax parser used by Taffy's parse feature.
pub fn components(value: &str) -> Result<Vec<String>, String> {
    fn consume(input: &mut Parser<'_, '_>) -> Result<(), String> {
        while !input.is_exhausted() {
            let token = input
                .next()
                .map_err(|e| format!("Invalid CSS: {e:?}"))?
                .clone();
            if matches!(
                token,
                Token::Function(_)
                    | Token::ParenthesisBlock
                    | Token::SquareBracketBlock
                    | Token::CurlyBracketBlock
            ) {
                input
                    .parse_nested_block::<_, _, ()>(|nested| {
                        consume(nested).map_err(|_| nested.new_custom_error(()))
                    })
                    .map_err(|e| format!("Invalid CSS block: {e:?}"))?;
            }
        }
        Ok(())
    }
    let mut source = ParserInput::new(value);
    let mut input = Parser::new(&mut source);
    let mut result = Vec::new();
    while !input.is_exhausted() {
        // next() skips whitespace/comments; preserve functions and quoted values.
        let token = input
            .next()
            .map_err(|e| format!("Invalid CSS value: {e:?}"))?
            .clone();
        let content_start = input.position();
        let nested = matches!(
            token,
            Token::Function(_)
                | Token::ParenthesisBlock
                | Token::SquareBracketBlock
                | Token::CurlyBracketBlock
        );
        if nested {
            input
                .parse_nested_block::<_, _, ()>(|nested| {
                    consume(nested).map_err(|_| nested.new_custom_error(()))
                })
                .map_err(|e| format!("Invalid CSS block: {e:?}"))?;
        }
        let text = if nested {
            format!(
                "{}{}",
                token.to_css_string(),
                input.slice_from(content_start)
            )
        } else {
            token.to_css_string()
        };
        if matches!(token, Token::BadString(_) | Token::BadUrl(_)) {
            return Err("Invalid CSS token".into());
        }
        result.push(text);
    }
    Ok(result)
}

fn expand(declaration: &Declaration) -> Result<(Expanded, bool), String> {
    let mut parts = components(&declaration.value)?;
    let important = parts.len() >= 2
        && parts[parts.len() - 2] == "!"
        && parts
            .last()
            .is_some_and(|s| s.eq_ignore_ascii_case("important"));
    if important {
        parts.truncate(parts.len() - 2);
    }
    if parts.is_empty() {
        return Err(format!("Empty CSS value for {}", declaration.property));
    }
    let property = declaration.property.as_str();
    let value = parts.join(" ");
    let mut result = Vec::new();
    if matches!(
        property,
        "margin" | "padding" | "border-width" | "border-radius"
    ) {
        if parts.len() > 4 {
            return Err(format!("Invalid {property} shorthand"));
        }
        let values = [
            &parts[0],
            parts.get(1).unwrap_or(&parts[0]),
            parts.get(2).unwrap_or(&parts[0]),
            parts.get(3).or(parts.get(1)).unwrap_or(&parts[0]),
        ];
        for (side, value) in ["top", "right", "bottom", "left"].into_iter().zip(values) {
            let name = if property == "border-width" {
                format!("border-{side}-width")
            } else if property == "border-radius" {
                format!(
                    "border-{}-radius",
                    match side {
                        "top" => "top-left",
                        "right" => "top-right",
                        "bottom" => "bottom-right",
                        _ => "bottom-left",
                    }
                )
            } else {
                format!("{property}-{side}")
            };
            result.push((name, value.clone()));
        }
    } else if property == "gap" {
        if parts.len() > 2 {
            return Err("Invalid gap shorthand".into());
        }
        result.push(("row-gap".into(), parts[0].clone()));
        result.push((
            "column-gap".into(),
            parts.get(1).unwrap_or(&parts[0]).clone(),
        ));
    } else if property == "border" {
        let mut width = "medium".to_owned();
        let mut color = "currentColor".to_owned();
        let mut border_style = "none";
        for part in &parts {
            if matches!(part.as_str(), "none" | "solid" | "dashed") {
                border_style = part;
            } else if part
                .as_bytes()
                .first()
                .is_some_and(|b| b.is_ascii_digit() || *b == b'.')
                || matches!(part.as_str(), "thin" | "medium" | "thick")
            {
                width = part.clone();
            } else {
                color = part.clone();
            }
        }
        for side in ["top", "right", "bottom", "left"] {
            result.push((
                format!("border-{side}-width"),
                if border_style == "none" {
                    "0".into()
                } else {
                    width.clone()
                },
            ));
        }
        result.push(("border-color".into(), color));
        result.push((
            "border-style".into(),
            if border_style == "none" {
                "solid".into()
            } else {
                border_style.into()
            },
        ));
    } else if property == "background" {
        // The GPUI adapter validates this as a color, rejecting image/gradient shorthands.
        result.push(("background-color".into(), value));
    } else {
        result.push((property.into(), value));
    }
    Ok((result, important))
}

fn previous_element(nodes: &[Node], index: usize) -> Option<usize> {
    (0..index).rev().find(|&i| {
        nodes[i].parent() == nodes[index].parent() && matches!(nodes[i], Node::Element { .. })
    })
}
fn matches(nodes: &[Node], index: usize, chain: &[Selector], state: usize) -> bool {
    let Some((last, rest)) = chain.split_last() else {
        return false;
    };
    let Node::Element {
        tag, attributes, ..
    } = &nodes[index]
    else {
        return false;
    };
    if !last.selectors.iter().all(|part| match part {
        SimpleSelector::Tag { name } => name == "*" || name == tag,
        SimpleSelector::Class { name } | SimpleSelector::Scope { name } => attributes
            .get("class")
            .is_some_and(|classes| classes.split_ascii_whitespace().any(|class| class == name)),
        SimpleSelector::Id { name } => attributes.get("id") == Some(name),
        SimpleSelector::State { name } => match name.as_str() {
            "hover" => state & 1 != 0,
            "focus" => state & 2 != 0,
            _ => false,
        },
    }) {
        return false;
    }
    if rest.is_empty() {
        return true;
    }
    match last.combinator.as_deref() {
        Some(">") => nodes[index]
            .parent()
            .is_some_and(|parent| matches(nodes, parent, rest, 0)),
        Some(" ") => {
            let mut parent = nodes[index].parent();
            while let Some(p) = parent {
                if matches(nodes, p, rest, 0) {
                    return true;
                }
                parent = nodes[p].parent();
            }
            false
        }
        Some("+") => previous_element(nodes, index).is_some_and(|s| matches(nodes, s, rest, 0)),
        Some("~") => {
            let mut previous = previous_element(nodes, index);
            while let Some(p) = previous {
                if matches(nodes, p, rest, 0) {
                    return true;
                }
                previous = previous_element(nodes, p);
            }
            false
        }
        _ => false,
    }
}

pub fn prepare(nodes: &[Node], rules: &[Rule]) -> Result<Vec<CascadedStyle>, String> {
    let mut expanded = Vec::new();
    for rule in rules {
        for chain in &rule.selectors {
            if chain.is_empty() {
                return Err("Empty CSS selector".into());
            }
            for (index, part) in chain.iter().enumerate() {
                if part.selectors.is_empty()
                    || (index == 0 && part.combinator.is_some())
                    || (index > 0
                        && !matches!(part.combinator.as_deref(), Some(" " | ">" | "+" | "~")))
                {
                    return Err("Invalid CSS selector chain".into());
                }
                for selector in &part.selectors {
                    if let SimpleSelector::State { name } = selector
                        && (!matches!(name.as_str(), "hover" | "focus") || index != chain.len() - 1)
                    {
                        return Err("Only target :hover/:focus selectors are implemented".into());
                    }
                }
            }
        }
        expanded.push(
            rule.declarations
                .iter()
                .map(expand)
                .collect::<Result<Vec<_>, _>>()?,
        );
    }
    nodes
        .iter()
        .enumerate()
        .map(|(index, node)| {
            let inline = if let Node::Element { style, .. } = node {
                style.iter().map(expand).collect::<Result<Vec<_>, _>>()?
            } else {
                Vec::new()
            };
            let mut states = std::array::from_fn(|_| Properties::new());
            for (state, properties) in states.iter_mut().enumerate() {
                let mut winners = BTreeMap::<String, (Priority, String)>::new();
                let mut apply = |items: &[(Expanded, bool)], specificity, order| {
                    for (declarations, important) in items {
                        for (property, value) in declarations {
                            let priority = (*important, specificity, order);
                            if winners
                                .get(property)
                                .is_none_or(|(old, _)| priority >= *old)
                            {
                                winners.insert(property.clone(), (priority, value.clone()));
                            }
                        }
                    }
                };
                for (order, rule) in rules.iter().enumerate() {
                    let specificity = rule
                        .selectors
                        .iter()
                        .filter(|chain| matches(nodes, index, chain, state))
                        .map(|chain| {
                            let mut result = [0; 4];
                            for part in chain {
                                for selector in &part.selectors {
                                    match selector {
                                        SimpleSelector::Id { .. } => result[1] += 1,
                                        SimpleSelector::Class { .. }
                                        | SimpleSelector::State { .. } => result[2] += 1,
                                        SimpleSelector::Tag { name } if name != "*" => {
                                            result[3] += 1
                                        }
                                        _ => {}
                                    }
                                }
                            }
                            result
                        })
                        .max();
                    if let Some(specificity) = specificity {
                        apply(&expanded[order], specificity, order);
                    }
                }
                apply(&inline, [1, 0, 0, 0], rules.len());
                *properties = winners
                    .into_iter()
                    .map(|(property, (_, value))| (property, value))
                    .collect();
            }
            Ok(CascadedStyle { states })
        })
        .collect()
}
