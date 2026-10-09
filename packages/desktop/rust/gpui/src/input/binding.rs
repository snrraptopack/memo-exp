//! Reconcile native edits with accepted authored state without round-trip editing.
use super::state::EditState;

pub struct BindingState {
    controlled: bool,
    expect_ack: bool,
    accepted: String,
    published: String,
    edit: u64,
    acknowledged: u64,
}
impl BindingState {
    pub fn new(value: &str, state: &EditState, controlled: bool, expect_ack: bool) -> Self {
        Self {
            controlled,
            expect_ack,
            accepted: value.into(),
            published: state.text.clone(),
            edit: 0,
            acknowledged: 0,
        }
    }
    fn reconcile(&mut self, state: &mut EditState) -> bool {
        if !self.controlled || self.edit != self.acknowledged || state.marked.is_some() {
            return false;
        }
        let value = super::state::sanitize(&self.accepted);
        if state.text == value {
            return false;
        }
        state.set_value(&value);
        self.published = state.text.clone();
        true
    }
    pub fn sync(&mut self, value: &str, state: &mut EditState) -> bool {
        if self.accepted == value {
            return false;
        }
        self.accepted = value.into();
        self.reconcile(state)
    }
    pub fn acknowledge(
        &mut self,
        edit: u64,
        value: &str,
        state: &mut EditState,
    ) -> Result<bool, String> {
        if edit == 0 || edit > self.edit {
            return Err("Unknown native input edit".into());
        }
        if edit <= self.acknowledged {
            return Ok(false);
        }
        self.acknowledged = edit;
        self.accepted = value.into();
        Ok(self.reconcile(state))
    }
    pub fn publish(&mut self, state: &mut EditState) -> Option<(String, u64)> {
        if state.text == self.published {
            // A canceled composition may expose a deferred authored update.
            self.reconcile(state);
            return None;
        }
        self.published = state.text.clone();
        self.edit += 1;
        if !self.expect_ack {
            self.acknowledged = self.edit;
        }
        Some((self.published.clone(), self.edit))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn control() -> (EditState, BindingState) {
        let state = EditState::new("");
        let binding = BindingState::new("", &state, true, true);
        (state, binding)
    }
    fn insert(state: &mut EditState, binding: &mut BindingState, value: &str) -> u64 {
        state.replace(None, value, None);
        binding.publish(state).unwrap().1
    }
    #[test]
    fn delayed_acknowledgment_cannot_overwrite_later_native_typing() {
        let (mut state, mut binding) = control();
        let first = insert(&mut state, &mut binding, "a");
        let second = insert(&mut state, &mut binding, "b");
        assert!(!binding.acknowledge(first, "A", &mut state).unwrap());
        assert_eq!(state.text, "ab");
        assert!(binding.acknowledge(second, "AB", &mut state).unwrap());
        assert_eq!(state.text, "AB");
    }
    #[test]
    fn older_and_duplicate_acknowledgments_do_not_replace_the_latest_accepted_value() {
        let (mut state, mut binding) = control();
        let first = insert(&mut state, &mut binding, "a");
        let second = insert(&mut state, &mut binding, "b");
        binding.acknowledge(second, "AB", &mut state).unwrap();
        assert!(!binding.acknowledge(first, "a", &mut state).unwrap());
        assert!(!binding.acknowledge(second, "ab", &mut state).unwrap());
        assert_eq!(state.text, "AB");
    }
    #[test]
    fn rejected_latest_edit_restores_authored_value_and_preserves_valid_selection() {
        let (mut state, mut binding) = control();
        let edit = insert(&mut state, &mut binding, "静🙂");
        assert!(binding.acknowledge(edit, "", &mut state).unwrap());
        assert_eq!(state.text, "");
        assert_eq!(state.selection(), 0..0);
        assert!(binding.sync("é\n", &mut state));
        assert_eq!(state.text, "é");
        assert!(binding.publish(&mut state).is_none());
    }
    #[test]
    fn composition_defers_reconciliation_and_commits_one_semantic_edit() {
        let (mut state, mut binding) = control();
        let first = insert(&mut state, &mut binding, "a");
        state.replace(None, "に", Some(None));
        binding.acknowledge(first, "A", &mut state).unwrap();
        assert_eq!(state.text, "aに");
        assert!(state.marked.is_some());
        state.replace(None, "日本", None);
        let (value, second) = binding.publish(&mut state).unwrap();
        assert_eq!(value, "a日本");
        assert_eq!(second, 2);
        binding.acknowledge(second, "A日本", &mut state).unwrap();
        assert_eq!(state.text, "A日本");
    }
    #[test]
    fn canceled_composition_applies_deferred_authored_value_without_a_duplicate_event() {
        let (mut state, mut binding) = control();
        let first = insert(&mut state, &mut binding, "a");
        state.replace(None, "に", Some(None));
        binding.acknowledge(first, "A", &mut state).unwrap();
        state.replace(None, "", None);
        assert!(binding.publish(&mut state).is_none());
        assert_eq!(state.text, "A");
        assert!(state.marked.is_none());
    }
    #[test]
    fn unbound_inputs_keep_native_values_and_invalid_edits_do_not_mutate_binding_state() {
        let mut state = EditState::new("seed");
        let mut binding = BindingState::new("seed", &state, false, false);
        state.move_to(state.text.len(), false);
        let edit = insert(&mut state, &mut binding, "🙂");
        assert!(!binding.sync("other", &mut state));
        assert_eq!(state.text, "seed🙂");
        assert!(binding.acknowledge(0, "bad", &mut state).is_err());
        assert!(binding.acknowledge(edit + 1, "bad", &mut state).is_err());
        assert_eq!(state.text, "seed🙂");
    }
}
