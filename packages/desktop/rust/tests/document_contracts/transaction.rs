//! Mixed publication exercises real engine ownership without another test binary.

use super::{body_text, comment, element, host, template, text, text_at};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use blitz_dom::DocumentConfig;
use blitz_traits::shell::ShellProvider;
use memoized_dom_desktop::document::{
    DocumentError, MountTarget, Mutation, NativeDocument, Operation, Owner,
};

fn write(owner: &Owner, source: u32, value: &str) -> Operation<'static> {
    Operation::Write(Mutation::Text {
        target: owner.node(source),
        value: value.to_string(),
    })
}

#[test]
fn adjacent_writes_use_one_mutator_and_keep_authored_order() {
    let (mut document, shell) = host();
    let owner = Owner::new("row", 1);
    let source = template(vec![text("before", None), text("second", None)]);
    document
        .mount(owner.clone(), &source, MountTarget::Body)
        .unwrap();
    shell.redraws.store(0, Ordering::SeqCst);
    document
        .transact(&[
            write(&owner, 0, "first"),
            write(&owner, 1, "updated"),
            write(&owner, 0, "last"),
        ])
        .unwrap();
    assert_eq!(body_text(&document), "lastupdated");
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 1);
}

#[test]
fn late_bad_write_refuses_an_earlier_mount_without_generation_or_redraw() {
    let (mut document, shell) = host();
    let owner = Owner::new("new", 1);
    let source = template(vec![text("before", None)]);
    assert_eq!(
        document.transact(&[
            Operation::Mount {
                owner: owner.clone(),
                template: &source,
                target: MountTarget::Body
            },
            write(&owner, 99, "bad"),
        ]),
        Err(DocumentError::UnknownSource)
    );
    assert_eq!(document.owner_count(), 0);
    assert!(
        document
            .engine()
            .get_node(document.body())
            .unwrap()
            .children
            .is_empty()
    );
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);

    document
        .transact(&[
            Operation::Mount {
                owner: owner.clone(),
                template: &source,
                target: MountTarget::Body,
            },
            write(&owner, 0, "accepted"),
        ])
        .unwrap();
    assert_eq!(text_at(&document, &owner, 0), "accepted");
}

#[test]
fn new_parent_element_and_region_sources_are_valid_destinations_in_the_same_batch() {
    let (mut document, _) = host();
    let parent = Owner::new("parent", 1);
    let element_child = Owner::new("element-child", 1);
    let region_child = Owner::new("region-child", 1);
    let parent_source = template(vec![element("div", vec![], None), comment(Some(0))]);
    let child_source = template(vec![text("child", None)]);
    document
        .transact(&[
            Operation::Mount {
                owner: parent.clone(),
                template: &parent_source,
                target: MountTarget::Body,
            },
            Operation::Mount {
                owner: element_child.clone(),
                template: &child_source,
                target: MountTarget::Element(parent.node(0)),
            },
            Operation::Mount {
                owner: region_child.clone(),
                template: &child_source,
                target: MountTarget::Region(parent.node(1)),
            },
            write(&element_child, 0, "element"),
            write(&region_child, 0, "region"),
        ])
        .unwrap();
    assert_eq!(document.owner_count(), 3);
    assert_eq!(body_text(&document), "regionelement");
}

#[test]
fn mixed_mount_move_write_and_retire_retains_existing_native_identity() {
    let (mut document, _) = host();
    let a = Owner::new("a", 1);
    let b = Owner::new("b", 1);
    let c = Owner::new("c", 1);
    let source = template(vec![text("row", None)]);
    document
        .mount(a.clone(), &source, MountTarget::Body)
        .unwrap();
    document
        .mount(b.clone(), &source, MountTarget::Body)
        .unwrap();
    let b_id = document.node_id(&b.node(0)).unwrap();
    let a_id = document.node_id(&a.node(0)).unwrap();
    document
        .transact(&[
            Operation::Mount {
                owner: c.clone(),
                template: &source,
                target: MountTarget::Body,
            },
            write(&c, 0, "C"),
            Operation::MoveBefore {
                owner: c.clone(),
                before: a.clone(),
            },
            Operation::MoveToEnd { owner: a.clone() },
            write(&b, 0, "B"),
            Operation::Retire { owner: a.clone() },
        ])
        .unwrap();
    assert_eq!(body_text(&document), "CB");
    assert_eq!(document.node_id(&b.node(0)).unwrap(), b_id);
    assert!(document.engine().get_node(a_id).is_none());
    assert_eq!(document.owner_count(), 2);
}

#[test]
fn late_invalid_move_preserves_earlier_writes_retirement_order_and_generation() {
    let (mut document, shell) = host();
    let parent = Owner::new("parent", 1);
    let child = Owner::new("child", 1);
    let sibling = Owner::new("sibling", 1);
    let parent_source = template(vec![element("div", vec![], None)]);
    let child_source = template(vec![text("before", None)]);
    document
        .mount(parent.clone(), &parent_source, MountTarget::Body)
        .unwrap();
    document
        .mount(
            child.clone(),
            &child_source,
            MountTarget::Element(parent.node(0)),
        )
        .unwrap();
    document
        .mount(sibling.clone(), &child_source, MountTarget::Body)
        .unwrap();
    let child_id = document.node_id(&child.node(0)).unwrap();
    shell.redraws.store(0, Ordering::SeqCst);
    assert_eq!(
        document.transact(&[
            write(&child, 0, "candidate"),
            Operation::Retire {
                owner: sibling.clone()
            },
            Operation::Mount {
                owner: Owner::new("sibling", 2),
                template: &child_source,
                target: MountTarget::Body
            },
            Operation::MoveBefore {
                owner: child.clone(),
                before: Owner::new("sibling", 2)
            },
        ]),
        Err(DocumentError::DifferentTarget)
    );
    assert_eq!(text_at(&document, &child, 0), "before");
    assert_eq!(document.node_id(&child.node(0)).unwrap(), child_id);
    assert_eq!(document.owner_count(), 3);
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
    document.retire(&sibling).unwrap();
    document
        .mount(Owner::new("sibling", 2), &child_source, MountTarget::Body)
        .unwrap();
}

#[test]
fn retiring_parent_refuses_later_writes_to_live_and_candidate_descendants() {
    let (mut document, shell) = host();
    let parent = Owner::new("parent", 1);
    let existing = Owner::new("existing", 1);
    let candidate = Owner::new("candidate", 1);
    let parent_source = template(vec![element("div", vec![], None)]);
    let child_source = template(vec![text("before", None)]);
    document
        .mount(parent.clone(), &parent_source, MountTarget::Body)
        .unwrap();
    document
        .mount(
            existing.clone(),
            &child_source,
            MountTarget::Element(parent.node(0)),
        )
        .unwrap();
    shell.redraws.store(0, Ordering::SeqCst);
    for invalid in [&existing, &candidate] {
        assert_eq!(
            document.transact(&[
                Operation::Mount {
                    owner: candidate.clone(),
                    template: &child_source,
                    target: MountTarget::Element(parent.node(0))
                },
                Operation::Retire {
                    owner: parent.clone()
                },
                write(invalid, 0, "after retirement"),
            ]),
            Err(DocumentError::UnknownOwner)
        );
        assert_eq!(document.owner_count(), 2);
        assert_eq!(text_at(&document, &existing, 0), "before");
        assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
    }
}

#[test]
fn candidate_parent_retirement_covers_nested_empty_and_region_children() {
    let (mut document, shell) = host();
    let parent = Owner::new("parent", 1);
    let child = Owner::new("child", 1);
    let empty = Owner::new("empty", 1);
    let parent_source = template(vec![comment(None)]);
    let child_source = template(vec![element("div", vec![], None)]);
    let empty_source = template(vec![]);
    assert_eq!(
        document.transact(&[
            Operation::Mount {
                owner: parent.clone(),
                template: &parent_source,
                target: MountTarget::Body
            },
            Operation::Mount {
                owner: child.clone(),
                template: &child_source,
                target: MountTarget::Region(parent.node(0))
            },
            Operation::Mount {
                owner: empty.clone(),
                template: &empty_source,
                target: MountTarget::Element(child.node(0))
            },
            Operation::Retire {
                owner: parent.clone()
            },
            Operation::MoveToEnd {
                owner: empty.clone()
            },
        ]),
        Err(DocumentError::UnknownOwner)
    );
    assert_eq!(document.owner_count(), 0);
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
}

#[test]
fn replace_generation_in_one_batch_rejects_old_refs_and_preserves_outside_replacements() {
    let (mut document, _) = host();
    let parent = Owner::new("parent", 1);
    let old = Owner::new("row", 1);
    let new = Owner::new("row", 2);
    let parent_source = template(vec![element("div", vec![], None)]);
    let source = template(vec![text("before", None)]);
    document
        .mount(parent.clone(), &parent_source, MountTarget::Body)
        .unwrap();
    document
        .mount(old.clone(), &source, MountTarget::Element(parent.node(0)))
        .unwrap();
    assert_eq!(
        document.transact(&[
            Operation::Retire { owner: old.clone() },
            Operation::Mount {
                owner: new.clone(),
                template: &source,
                target: MountTarget::Body
            },
            write(&old, 0, "stale"),
        ]),
        Err(DocumentError::UnknownOwner)
    );
    assert_eq!(text_at(&document, &old, 0), "before");

    document
        .transact(&[
            Operation::Retire { owner: old.clone() },
            Operation::Mount {
                owner: new.clone(),
                template: &source,
                target: MountTarget::Body,
            },
            Operation::Retire {
                owner: parent.clone(),
            },
            write(&new, 0, "outside survives"),
        ])
        .unwrap();
    assert_eq!(document.owner_count(), 1);
    assert_eq!(body_text(&document), "outside survives");
}

#[test]
fn staged_generation_high_water_marks_and_duplicate_owners_match_live_rules() {
    let (mut document, shell) = host();
    let owner = Owner::new("row", 1);
    let source = template(vec![text("row", None)]);
    assert_eq!(
        document.transact(&[
            Operation::Mount {
                owner: owner.clone(),
                template: &source,
                target: MountTarget::Body
            },
            Operation::Mount {
                owner: Owner::new("row", 2),
                template: &source,
                target: MountTarget::Body
            },
        ]),
        Err(DocumentError::DuplicateOwner)
    );
    assert_eq!(
        document.transact(&[
            Operation::Mount {
                owner: owner.clone(),
                template: &source,
                target: MountTarget::Body
            },
            Operation::Retire {
                owner: owner.clone()
            },
            Operation::Mount {
                owner: owner.clone(),
                template: &source,
                target: MountTarget::Body
            },
        ]),
        Err(DocumentError::StaleGeneration)
    );
    assert_eq!(document.owner_count(), 0);
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
    document
        .transact(&[
            Operation::Mount {
                owner: owner.clone(),
                template: &source,
                target: MountTarget::Body,
            },
            Operation::Retire { owner },
            Operation::Mount {
                owner: Owner::new("row", 2),
                template: &source,
                target: MountTarget::Body,
            },
        ])
        .unwrap();
    assert_eq!(document.owner_count(), 1);
}

#[test]
fn candidate_invalid_targets_and_self_containment_refuse_before_mount() {
    let (mut document, shell) = host();
    let owner = Owner::new("parent", 1);
    let child = Owner::new("child", 1);
    let source = template(vec![text("row", None)]);
    assert_eq!(
        document.transact(&[Operation::Mount {
            owner: owner.clone(),
            template: &source,
            target: MountTarget::Element(owner.node(0))
        },]),
        Err(DocumentError::UnknownOwner)
    );
    for target in [
        MountTarget::Element(owner.node(0)),
        MountTarget::Region(owner.node(0)),
    ] {
        assert_eq!(
            document.transact(&[
                Operation::Mount {
                    owner: owner.clone(),
                    template: &source,
                    target: MountTarget::Body
                },
                Operation::Mount {
                    owner: child.clone(),
                    template: &source,
                    target
                },
            ]),
            Err(DocumentError::WrongNodeKind)
        );
    }
    assert_eq!(document.owner_count(), 0);
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
}

#[test]
fn retire_then_write_to_nested_live_region_owner_is_a_safe_refusal() {
    let (mut document, shell) = host();
    let parent = Owner::new("parent", 1);
    let child = Owner::new("child", 1);
    let grandchild = Owner::new("grandchild", 1);
    let source = template(vec![comment(None)]);
    let leaf = template(vec![text("leaf", None)]);
    document
        .mount(parent.clone(), &source, MountTarget::Body)
        .unwrap();
    document
        .mount(child.clone(), &source, MountTarget::Region(parent.node(0)))
        .unwrap();
    document
        .mount(
            grandchild.clone(),
            &leaf,
            MountTarget::Region(child.node(0)),
        )
        .unwrap();
    shell.redraws.store(0, Ordering::SeqCst);
    assert_eq!(
        document.transact(&[
            Operation::Retire {
                owner: child.clone()
            },
            write(&grandchild, 0, "bad"),
        ]),
        Err(DocumentError::UnknownOwner)
    );
    assert_eq!(body_text(&document), "leaf");
    assert_eq!(document.owner_count(), 3);
    assert_eq!(shell.redraws.load(Ordering::SeqCst), 0);
    document
        .transact(&[
            Operation::Retire { owner: grandchild },
            Operation::Retire { owner: child },
            Operation::Retire { owner: parent },
        ])
        .unwrap();
    assert_eq!(document.owner_count(), 0);
}

#[derive(Default)]
struct FailingShell {
    countdown: AtomicUsize,
}

impl ShellProvider for FailingShell {
    fn request_redraw(&self) {
        let count = self.countdown.load(Ordering::SeqCst);
        if count > 0 && self.countdown.fetch_sub(1, Ordering::SeqCst) == 1 {
            // Fail once so unwinding cannot panic again during cleanup.
            panic!("injected platform failure after native application");
        }
    }
}

#[test]
fn unexpected_platform_failure_during_mixed_application_is_terminal() {
    let shell = Arc::new(FailingShell::default());
    let mut document = NativeDocument::new(DocumentConfig {
        shell_provider: Some(shell.clone()),
        ..DocumentConfig::default()
    });
    let owner = Owner::new("row", 1);
    let source = template(vec![text("before", None)]);
    document
        .mount(owner.clone(), &source, MountTarget::Body)
        .unwrap();
    let node = document.node_id(&owner.node(0)).unwrap();
    shell.countdown.store(1, Ordering::SeqCst);
    assert_eq!(
        document.transact(&[
            write(&owner, 0, "partially applied"),
            Operation::Retire {
                owner: owner.clone()
            },
        ]),
        Err(DocumentError::ApplicationFailed)
    );
    assert_eq!(
        document.engine().get_node(node).unwrap().text_content(),
        "partially applied"
    );
    assert!(document.is_failed());
    assert_eq!(document.owner_count(), 1);
    assert_eq!(document.transact(&[]), Err(DocumentError::FailedDocument));
    assert_eq!(document.retire(&owner), Err(DocumentError::FailedDocument));
}
