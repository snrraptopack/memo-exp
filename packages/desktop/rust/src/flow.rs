//! Placement-aware native flow, retained independently of GPUI frames.
//!
//! Template plans describe immutable local content. This plan expands accepted
//! component regions before deciding anonymous paragraph and flex/grid items.
//! Named paragraphs reuse their existing accepted text groups; anonymous groups
//! use the same source walker and value comparison as local composition.
use crate::{
    Instance,
    composition::{text_paths, text_value},
    forest::Placements,
    presentation::{ItemKind, TextPath, TextSource, TextValue},
    tags::{self, Content, Layout},
    template::Node,
};
use serde::Serialize;
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::Arc,
};

/// Owner ID, owner generation, authored anchor node, and anonymous-group flag.
/// The flag distinguishes a flex/grid element from block-flow text anchored to it.
pub type TextIdentity = (u64, u64, usize, bool);

#[derive(Clone, Debug, Serialize)]
pub struct PlacedItem {
    pub kind: ItemKind,
    pub source: TextSource,
    pub parent: Option<usize>,
    pub group: Option<usize>,
    /// Anonymous paragraphs anchor to their first authored inline node. Their
    /// surrounding element supplies inherited styles, not another authored ID.
    pub anchor: Option<TextSource>,
}

impl PlacedItem {
    pub fn anonymous(&self) -> bool {
        self.anchor.is_some()
    }

    pub fn text_identity(&self) -> TextIdentity {
        let source = self.anchor.unwrap_or(self.source);
        (
            source.handle.id,
            source.handle.generation,
            source.node,
            self.anonymous(),
        )
    }
}

enum Input {
    Local {
        owner: u64,
        group: usize,
    },
    Composed {
        paths: Vec<Arc<TextPath>>,
        marker: Option<(u64, usize)>,
    },
}

#[derive(Default, Serialize)]
struct FlowLayout {
    items: Vec<PlacedItem>,
    /// Inline elements with independent Taffy boxes in this accepted placement.
    #[serde(skip)]
    boxed_inline: BTreeMap<u64, Arc<BTreeSet<usize>>>,
    #[serde(skip)]
    children: Vec<Vec<usize>>,
    #[serde(skip)]
    inputs: Vec<Input>,
    #[serde(skip)]
    keys: Vec<TextIdentity>,
    #[serde(skip)]
    consumers: BTreeMap<u64, BTreeSet<usize>>,
    #[serde(skip)]
    modes: Vec<(TextSource, bool)>,
}

#[derive(Clone, Default, Serialize)]
pub struct SceneFlow {
    #[serde(flatten)]
    layout: Arc<FlowLayout>,
    #[serde(rename = "text_groups")]
    values: Arc<[TextValue]>,
}

enum Job {
    Element(TextSource, Option<usize>),
    Text {
        nodes: Vec<TextSource>,
        container: Option<TextSource>,
        parent: Option<usize>,
        marker: Option<(u64, usize)>,
    },
}

impl SceneFlow {
    pub fn items(&self) -> &[PlacedItem] {
        &self.layout.items
    }
    pub fn children(&self, item: usize) -> &[usize] {
        &self.layout.children[item]
    }
    pub fn values(&self) -> &[TextValue] {
        &self.values
    }
    pub fn text_identity(&self, group: usize) -> TextIdentity {
        self.layout.keys[group]
    }
    pub fn is_empty(&self) -> bool {
        self.layout.items.is_empty()
    }

    pub fn boxed_inline(&self, owner: u64) -> Option<&Arc<BTreeSet<usize>>> {
        self.layout.boxed_inline.get(&owner)
    }

    pub(crate) fn inline_placements_changed(&self, previous: &Self) -> bool {
        !Arc::ptr_eq(&self.layout, &previous.layout)
            && self.layout.boxed_inline != previous.layout.boxed_inline
    }

    pub(crate) fn needs_rebuild(&self, records: &BTreeMap<u64, &Instance>) -> Result<bool, String> {
        for &(source, previous) in &self.layout.modes {
            if itemized(records[&source.handle.id], source.node)? != previous {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub(crate) fn prepare(
        records: &BTreeMap<u64, &Instance>,
        previous: &Self,
    ) -> Result<Self, String> {
        let placements = Placements::new(records);
        let mut layout = FlowLayout::default();
        let mut jobs = Vec::new();
        // Index local groups once. Scanning the entire template for each placed
        // paragraph would make a large single-component document quadratic.
        let local_groups: BTreeMap<_, _> = records
            .values()
            .flat_map(|owner| {
                owner.template.presentation.items.iter().filter_map(|item| {
                    item.group
                        .map(|group| ((owner.handle.id, item.source), group))
                })
            })
            .collect();
        // Independent application roots keep separate formatting contexts.
        for owner in records
            .values()
            .rev()
            .filter(|owner| owner.attach_to.is_none())
        {
            let roots = placements.expand(placements.roots(owner.handle.id));
            jobs.extend(
                sequence(&placements, roots, None, None, false, None)
                    .into_iter()
                    .rev(),
            );
        }
        while let Some(job) = jobs.pop() {
            match job {
                Job::Element(source, parent) => {
                    let owner = records[&source.handle.id];
                    let Node::Element { tag, .. } = owner.node(source.node) else {
                        unreachable!()
                    };
                    let definition = tags::resolve(tag)?;
                    let inline_container =
                        definition.layout == Layout::Inline && itemized(owner, source.node)?;
                    let container = definition.layout == Layout::Block || inline_container;
                    let kind = match definition.layout {
                        _ if container => ItemKind::Container,
                        Layout::Block => ItemKind::Container,
                        Layout::Control => ItemKind::Button,
                        Layout::Input => ItemKind::Input,
                        _ => ItemKind::Paragraph,
                    };
                    let index = layout.items.len();
                    layout.items.push(PlacedItem {
                        kind,
                        source,
                        parent,
                        group: None,
                        anchor: None,
                    });
                    if definition.layout == Layout::Inline {
                        layout.modes.push((source, inline_container));
                    }
                    if container {
                        let mode = itemized(owner, source.node)?;
                        if definition.layout == Layout::Block {
                            layout.modes.push((source, mode));
                        }
                        let marker = owner
                            .template
                            .presentation
                            .marker_groups
                            .get(&source.node)
                            .map(|&group| (source.handle.id, group));
                        jobs.extend(
                            sequence(
                                &placements,
                                placements.children(source),
                                Some(source),
                                Some(index),
                                mode,
                                marker,
                            )
                            .into_iter()
                            .rev(),
                        );
                    } else if definition.layout != Layout::Input {
                        let input = if let Some(&group) =
                            local_groups.get(&(source.handle.id, source.node))
                        {
                            Input::Local {
                                owner: source.handle.id,
                                group,
                            }
                        } else {
                            let paths = text_paths(
                                &placements,
                                placements
                                    .children(source)
                                    .into_iter()
                                    .map(|source| (source, Vec::new()))
                                    .collect(),
                            );
                            Input::Composed {
                                paths,
                                marker: None,
                            }
                        };
                        layout.add_group(index, input);
                    }
                }
                Job::Text {
                    nodes,
                    container,
                    parent,
                    marker,
                } => {
                    let anchor = nodes
                        .first()
                        .copied()
                        .or(container)
                        .expect("Text group requires an authored anchor");
                    let index = layout.items.len();
                    layout.items.push(PlacedItem {
                        kind: ItemKind::Paragraph,
                        source: container.unwrap_or(anchor),
                        parent,
                        group: None,
                        anchor: Some(anchor),
                    });
                    let paths = text_paths(
                        &placements,
                        nodes
                            .into_iter()
                            .map(|source| (source, Vec::new()))
                            .collect(),
                    );
                    layout.add_group(index, Input::Composed { paths, marker });
                }
            }
        }
        layout.children = vec![Vec::new(); layout.items.len()];
        for (index, item) in layout.items.iter().enumerate() {
            if let Some(parent) = item.parent {
                layout.children[parent].push(index);
            }
            let owner = records[&item.source.handle.id];
            if !item.anonymous()
                && matches!(owner.node(item.source.node), Node::Element { tag, .. }
                    if tags::resolve(tag).is_ok_and(|tag| tag.layout == Layout::Inline))
            {
                let nodes = layout.boxed_inline.entry(owner.handle.id).or_default();
                Arc::make_mut(nodes).insert(item.source.node);
            }
        }
        // Tag support alone cannot establish a hit target. A span in a flex
        // container has a native box; a span flattened into a paragraph does not.
        for owner in records.values() {
            for event in &owner.template.source.events {
                if let Node::Element { tag, .. } = owner.node(event.node)
                    && tags::resolve(tag)?.layout == Layout::Inline
                    && !layout
                        .boxed_inline
                        .get(&owner.handle.id)
                        .is_some_and(|nodes| nodes.contains(&event.node))
                {
                    return Err(format!(
                        "Desktop template {}, node {} <{}>: inline events require an independent native box; paragraph-run hit testing is not implemented",
                        owner.template.source.id, event.node, tag
                    ));
                }
            }
        }
        let old: BTreeMap<_, _> = previous
            .layout
            .keys
            .iter()
            .copied()
            .zip(previous.values.iter())
            .collect();
        let values = layout
            .inputs
            .iter()
            .enumerate()
            .map(|(group, input)| {
                let prior = old.get(&layout.keys[group]).copied();
                read_input(input, |id| records[&id], prior)
            })
            .collect::<Vec<_>>();
        Ok(Self {
            layout: Arc::new(layout),
            values: values.into(),
        })
    }

    /// Reuse the accepted layout and source paths on ordinary text/property
    /// updates. Unaffected text values retain their strings, runs and revisions.
    pub(crate) fn refresh<'a>(
        &self,
        lookup: impl Fn(u64) -> &'a Instance,
        changed: &BTreeSet<u64>,
    ) -> Self {
        let pending: BTreeSet<_> = changed
            .iter()
            .filter_map(|id| self.layout.consumers.get(id))
            .flat_map(|groups| groups.iter().copied())
            .collect();
        if pending.is_empty() {
            return self.clone();
        }
        let mut values = self.values.to_vec();
        for group in pending {
            values[group] = read_input(
                &self.layout.inputs[group],
                &lookup,
                Some(&self.values[group]),
            );
        }
        Self {
            layout: self.layout.clone(),
            values: values.into(),
        }
    }
}

impl FlowLayout {
    fn add_group(&mut self, item: usize, input: Input) {
        let group = self.inputs.len();
        self.items[item].group = Some(group);
        self.keys.push(self.items[item].text_identity());
        match &input {
            Input::Local { owner, .. } => {
                self.consumers.entry(*owner).or_default().insert(group);
            }
            Input::Composed { paths, marker } => {
                for path in paths {
                    self.consumers
                        .entry(path.source.handle.id)
                        .or_default()
                        .insert(group);
                }
                if let Some((owner, _)) = marker {
                    self.consumers.entry(*owner).or_default().insert(group);
                }
            }
        }
        self.inputs.push(input);
    }
}

fn read_input<'a>(
    input: &Input,
    lookup: impl Fn(u64) -> &'a Instance,
    previous: Option<&TextValue>,
) -> TextValue {
    match input {
        Input::Local { owner, group } => lookup(*owner).text_groups[*group].clone(),
        Input::Composed { paths, marker } => {
            let prefix = marker
                .map(|(owner, group)| {
                    let owner = lookup(owner);
                    owner
                        .markers
                        .get(&group)
                        .unwrap_or(&owner.template.presentation.groups[group].prefix)
                        .as_str()
                })
                .unwrap_or("");
            let empty = TextValue {
                text: Arc::from(""),
                revision: 1,
                runs: Arc::from([]),
            };
            let prior = previous.unwrap_or(&empty);
            text_value(lookup, paths, prefix, prior, previous.is_none())
                .unwrap_or_else(|| prior.clone())
        }
    }
}

/// Expand regions first, then classify actual element roots. Flex/grid makes
/// every authored element a separate item; only adjacent text shares an item.
fn sequence(
    placements: &Placements<'_>,
    sources: Vec<TextSource>,
    container: Option<TextSource>,
    parent: Option<usize>,
    itemized: bool,
    mut marker: Option<(u64, usize)>,
) -> Vec<Job> {
    // A single authored application root keeps its own native source/ID. Inline
    // roots placed inside a container still participate in that container's flow.
    if container.is_none()
        && sources.len() == 1
        && matches!(
            placements.records[&sources[0].handle.id].node(sources[0].node),
            Node::Element { .. }
        )
    {
        return vec![Job::Element(sources[0], parent)];
    }
    let mut jobs = Vec::new();
    let mut inline = Vec::new();
    let list = container.is_some_and(|container| {
        let parent = placements.records[&container.handle.id];
        matches!(parent.node(container.node), Node::Element { tag, .. }
            if tags::resolve(tag).is_ok_and(|tag| tag.content == Content::List))
    });
    for source in sources {
        let owner = placements.records[&source.handle.id];
        let node = owner.node(source.node);
        if list
            && matches!(node, Node::Text { text, .. } if text.trim().is_empty())
            && !owner
                .template
                .source
                .slots
                .iter()
                .any(|slot| slot.node == source.node)
        {
            continue;
        }
        let joins = match node {
            Node::Text { .. } => true,
            Node::Element { tag, .. } => {
                !itemized && tags::resolve(tag).is_ok_and(|tag| tag.layout == Layout::Inline)
            }
            Node::Region { .. } => unreachable!("Placement expansion left a region"),
        };
        if joins {
            inline.push(source);
        } else {
            flush(&mut jobs, &mut inline, container, parent, &mut marker);
            if marker.is_some() {
                jobs.push(Job::Text {
                    nodes: Vec::new(),
                    container,
                    parent,
                    marker: marker.take(),
                });
            }
            jobs.push(Job::Element(source, parent));
        }
    }
    flush(&mut jobs, &mut inline, container, parent, &mut marker);
    if marker.is_some() {
        jobs.push(Job::Text {
            nodes: Vec::new(),
            container,
            parent,
            marker,
        });
    }
    jobs
}

fn flush(
    jobs: &mut Vec<Job>,
    inline: &mut Vec<TextSource>,
    container: Option<TextSource>,
    parent: Option<usize>,
    marker: &mut Option<(u64, usize)>,
) {
    if !inline.is_empty() {
        jobs.push(Job::Text {
            nodes: std::mem::take(inline),
            container,
            parent,
            marker: marker.take(),
        });
    }
}

fn itemized(owner: &Instance, node: usize) -> Result<bool, String> {
    let mode = |state: usize| {
        matches!(
            owner.styles[node].states[state]
                .get("display")
                .map(String::as_str),
            Some("flex" | "grid")
        )
    };
    let base = mode(0);
    if (1..4).any(|state| mode(state) != base) {
        return Err("CSS interaction display changes between block and flex/grid require native flow regrouping".into());
    }
    Ok(base)
}
