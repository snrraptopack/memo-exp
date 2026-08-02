/**
 * A focused R44 example: mutable refs, callback cleanup, multiple refs,
 * component forwarding, ordinary spread refs, branches, and keyed rows.
 */
import { ForwardedInput } from './ForwardedInput';
import {state,derived,useState} from "./state"

interface Probe {
  id: number;
  label: string;
}

interface RefEvent {
  id: number;
  message: string;
}

let probes: Probe[] = [
  { id: 1, label: 'Alpha probe' },
  { id: 2, label: 'Beta probe' },
];
let events: RefEvent[] = [];
let nextEventId = 1;

function record(message: string) {
  events.push({ id: nextEventId++, message });
}

function highlightedRef(name: string) {
  return (node: HTMLElement) => {
    node.dataset.refMounted = 'true';
    record(`mounted callback: ${name}`);
    return () => {
      delete node.dataset.refMounted;
      record(`cleaned callback: ${name}`);
    };
  };
}

export function RefsApp() {
  let panel: HTMLElement | undefined;
  let primaryInput: HTMLInputElement | undefined;
  let namedInput: HTMLInputElement | undefined;
  const nodes: {
    panel?: HTMLElement;
    primary?: HTMLInputElement;
  } = {};
  let showConditional = true;
  let action = 'No imperative ref action yet.';

  const spreadProps = {
    id: 'spread-probe',
    class: 'ref-probe',
    ref: highlightedRef('spread property'),
  };


  let count = 0
  function getCount() {
    return count
  }

  let count1 = state(0)
  const double1 = derived(count1 * 2)


  const double = getCount() * 2 //this wont work

  //const double = count * 2
  return (
    <main class="refs-app">
      <header>
        <p class="eyebrow">R44 · compiler-native lifecycle slots</p>
        <h1>DOM Ref Laboratory</h1>
        <p>
          Every value below is a real DOM node. There is no ref wrapper,
          runtime JSX object, or public ref key.
        </p>

        <button onClick={() => { count++; count1++;}}>
          count is {double} original is {count} the double1 {double1}
        </button>
      </header>

      <section
        id="mutable-panel"
        class="ref-panel"
        ref={[panel, nodes.panel, highlightedRef('mutable panel')]}
      >
        <h2>Mutable and multiple refs</h2>
        <p>
          One element assigns both mutable sinks and installs a callback ref.
        </p>
        <button onClick={() => {
          const selected = panel?.classList.toggle('selected') ?? false;
          action = selected
            ? 'Mutable panel ref added .selected.'
            : 'Mutable panel ref removed .selected.';
        }}>
          Toggle through mutable ref
        </button>
      </section>

      <section class="ref-panel">
        <h2>Component forwarding</h2>
        <div class="ref-fields">
          <ForwardedInput
            id="primary-input"
            label="Standard ref prop"
            placeholder="Focus me"
            ref={[primaryInput, nodes.primary, highlightedRef('primary input')]}
          />
          <ForwardedInput
            id="named-input"
            label="Named inputRef prop"
            placeholder="Named forwarding"
            inputRef={namedInput}
          />
        </div>
        <div class="actions">
          <button onClick={() => {
            primaryInput?.focus();
            action = primaryInput
              ? 'Standard ref focused #primary-input.'
              : 'Standard ref is unavailable.';
          }}>Focus standard ref</button>
          <button onClick={() => {
            namedInput?.focus();
            action = namedInput
              ? 'Named inputRef focused #named-input.'
              : 'Named inputRef is unavailable.';
          }}>Focus named ref</button>
          <button onClick={() => {
            if (nodes.primary) {
              nodes.primary.value = 'Selected through nodes.primary';
              nodes.primary.select();
              action = 'Member ref selected the primary input value.';
            } else {
              action = 'Member ref is unavailable.';
            }
          }}>
            Select through member ref
          </button>
        </div>
        <output class="ref-action">{action}</output>
      </section>

      <section class="ref-panel">
        <h2>Conditional ownership</h2>
        <button onClick={() => showConditional = !showConditional}>
          {showConditional ? 'Remove conditional node' : 'Mount conditional node'}
        </button>
        {showConditional ? (
          <div
            id="conditional-probe"
            class="ref-probe"
            ref={highlightedRef('conditional branch')}
          >
            Branch cleanup runs immediately when this node leaves.
          </div>
        ) : null}
        <div {...spreadProps}>Ordinary spread property callback ref.</div>
      </section>

      <section class="ref-panel">
        <div class="panel-heading">
          <div>
            <h2>Keyed-row ownership</h2>
            <p>Removing a row drains only that row’s callback ref.</p>
          </div>
          <button
            disabled={probes.length === 0}
            onClick={() => probes.pop()}
          >
            Remove last row
          </button>
        </div>
        <ul class="probe-list">
          {probes.map((probe) => (
            <li
              key={probe.id}
              ref={(node: HTMLLIElement) => {
                node.dataset.probeId = String(probe.id);
                record(`mounted row: ${probe.label}`);
                return () => {
                  delete node.dataset.probeId;
                  record(`cleaned row: ${probe.label}`);
                };
              }}
            >
              <strong>{probe.label}</strong>
              <span>stable keyed node #{probe.id}</span>
            </li>
          ))}
        </ul>
      </section>

      <section class="ref-panel">
        <div class="panel-heading">
          <div>
            <h2>Lifecycle trace</h2>
            <p>Callback setup and cleanup appear in execution order.</p>
          </div>
          <button onClick={() => events.splice(0)}>Clear trace</button>
        </div>
        <ol class="event-list">
          {events.map((event) => (
            <li key={event.id}>{event.message}</li>
          ))}
        </ol>
      </section>
    </main>
  );
}
