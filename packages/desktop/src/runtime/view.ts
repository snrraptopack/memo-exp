/** Presentation bookkeeping for generated closures; semantics stay in core. */
import {
  classValue,
  cleanup,
  isAriaAttribute,
  isHtmlBooleanAttribute,
  jsxAttributeName,
  invalidateEntity,
  registerEntity,
  rootFactoryStore,
  textValue
} from '@memoized-dom/runtime/core';

import {
  HostError,
  type Acceptance,
  type Destination,
  type Operation,
  type Owner,
  type Publication,
  type Template
} from '../host/protocol';
import type { SourceReference } from '../host/protocol';
import { withStylesheets } from './stylesheets';
export { registerStylesheet } from './stylesheets';

import type { NativeApplication } from './application';

export interface NativeFrame {
  readonly application: NativeApplication;
  readonly owner: Owner;
  readonly parent: string | null;
  readonly reportError: (error: unknown) => void;
  /** Compiler-private destination inherited by a nested component view. */
  readonly mountTarget?: Destination;
}

export interface NativeRootDefinition {
  readonly kind: 'native';
  readonly id: string;
  readonly create: (frame: NativeFrame) => NativeView;
}

/** Compiler metadata, using the same registry as browser root factories. */
export function registerNativeRoot(
  component: (frame: NativeFrame) => NativeView,
  id: string
): void {
  rootFactoryStore<NativeRootDefinition>().set(component, {
    kind: 'native',
    id,
    create: component
  });
}

export interface EvaluatedStep {
  readonly kind: 'attributes' | 'text';
  readonly source: number;
  readonly value: unknown
}

export interface NativeChild {
  readonly segment: string;
  readonly source: number;
  readonly create: (frame: NativeFrame) => NativeView;
}

/** Describe a child call without running it before its parent is registered. */
export function child(
  segment: string,
  source: number,
  create: (frame: NativeFrame) => NativeView,
): NativeChild {
  return { segment, source, create };
}

interface Snapshot {
  readonly operations: Operation[];
  readonly texts: Map<number, string>;
  readonly attributes: Map<number, Map<string, string>>;
  readonly handlers: Map<number, Map<string, (event: unknown) => unknown>>
}

/** Compiler-owned view, never an application mounting API or reactive engine. */
export class NativeView {
  private phase: 'prepared' | 'publishing' | 'active' | 'disposed' = 'prepared';
  private accepted?: Snapshot;
  private initial: Snapshot;
  private needsUpdate = false;
  private readonly pending = new Map<Promise<Acceptance>, Snapshot>();
  private lastPublication?: Promise<Acceptance>;
  private readonly children: NativeView[];

  constructor(
    private readonly frame: NativeFrame,
    readonly template: Template,
    private readonly evaluate: () => readonly EvaluatedStep[],
    children: readonly NativeChild[] = [],
  ) {
    this.template = withStylesheets(template);
    registerEntity({
      id: frame.owner.id,
      parent: frame.parent,
      render: () => this.render()
    });

    cleanup(frame.owner.id, () => this.dispose());
    this.initial = this.snapshot();
    this.children = this.createChildren(children);
  }

  get initialPublication(): Publication {
    if (this.phase === 'prepared') {
      if (this.needsUpdate) {
        this.initial = this.frame.application.run(() => this.snapshot());
      }

      this.needsUpdate = false;
      this.phase = 'publishing';
    }

    const templates = new Map<string, Template>([
      [this.template.key, this.template],
    ]);
    const operations: Operation[] = [
      {
        op: 'mount',
        owner: this.frame.owner,
        template: this.template.key,
        target: this.frame.mountTarget ?? { kind: 'body' },
      },
      ...this.initial.operations,
    ];

    for (const childView of this.children) {
      const publication = childView.initialPublication;

      for (const template of publication.templates ?? []) {
        templates.set(template.key, template);
      }

      operations.push(...publication.operations);
    }

    return {
      templates: [...templates.values()],
      operations,
    };
  }

  /** The owning candidate invokes this before shared refs/effects activate. */
  acceptInitial(): void {
    if (this.phase !== 'publishing') {
      throw new HostError('invalidView', 'Native view is not publishing');
    }

    this.accepted = this.initial;
    this.phase = 'active';

    for (const childView of this.children) {
      childView.acceptInitial();
    }
  }

  activateUpdates(): void {
    if (this.needsUpdate) {
      this.needsUpdate = false;
      invalidateEntity(this.frame.owner.id);
    }

    for (const childView of this.children) {
      childView.activateUpdates();
    }
  }

  dispatch(source: number | SourceReference, name: string, event: unknown): unknown {
    const view = typeof source === 'number' ? this : this.viewFor(source);

    if (view?.phase !== 'active') {
      throw new HostError('inactiveView', 'Native view is not active');
    }

    const address = typeof source === 'number' ? source : source.source;
    const handler = view.accepted?.handlers.get(address)?.get(name);

    return this.frame.application.run(() => handler?.(event));
  }

  matchesSource(source: SourceReference): boolean {
    return this.viewFor(source)?.phase === 'active';
  }

  eventTarget(source: number | SourceReference): object {
    const view = typeof source === 'number' ? this : this.viewFor(source);
    const address = typeof source === 'number' ? source : source.source;
    const node = view?.template.nodes[address]?.node;

    if (!node) throw new HostError('unknownEventSource', 'Native event source is unknown');
    const attributes = view.accepted?.attributes.get(address);
    const properties: Record<PropertyKey, unknown> = {
      nodeType: node.kind === 'element' ? 1 : node.kind === 'text' ? 3 : 8,
      nodeName: node.kind === 'element' ? node.name.local.toUpperCase() : node.kind === 'text' ? '#text' : '#comment',
      id: attributes?.get('id') ?? '',
      className: attributes?.get('class') ?? '',
      isConnected: this.phase === 'active',
      getAttribute: (name: string) => attributes?.get(name.toLowerCase()) ?? null,
      [Symbol.toStringTag]: 'NativeEventTarget'
    };
    if (node.kind === 'element') properties.tagName = properties.nodeName;
    return new Proxy(properties, {
      get(target, name) {
        if (name in target || typeof name === 'symbol') return target[name];
        throw new HostError('unsupportedEventTarget', `Native event target capability '${String(name)}' is not implemented`);
      },
      set() {
        throw new HostError('unsupportedEventTarget', 'Native event target writes require native ref capabilities');
      }
    });
  }

  async publication(): Promise<Acceptance | undefined> {
    const accepted = await Promise.all([
      this.lastPublication ?? Promise.resolve(undefined),
      ...this.children.map(childView => childView.publication()),
    ]);

    return accepted.reduce<Acceptance | undefined>((latest, candidate) => {
      if (candidate === undefined) {
        return latest;
      }

      return latest === undefined || candidate.sequence > latest.sequence
        ? candidate
        : latest;
    }, undefined);
  }

  dispose(): void {
    this.phase = 'disposed';
    this.accepted = undefined;
    this.pending.clear();
  }

  private render(): void {
    if (this.phase === 'disposed') {
      return;
    }

    if (this.phase === 'prepared' || this.phase === 'publishing') {
      // Source writes can race the initial acknowledgment. Recompute before
      // sending, or schedule a normal core render after acceptance; never send
      // an update referencing an owner that has not been accepted yet.
      this.needsUpdate = true;

      return;
    }

    // Shared access plans may conservatively target an owning component.
    // Preserve that subtree meaning without a second dependency resolver.
    for (const childView of this.children) {
      invalidateEntity(childView.frame.owner.id);
    }

    if (this.pending.size >= 8) {
      // Coalesce source changes through the existing core when a credit frees.
      // Do not discard a final user value merely because native work is busy.
      this.needsUpdate = true;

      return;
    }

    const next = this.snapshot();

    if (
      next.operations.length === 0 &&
      this.accepted !== undefined &&
      handlersEqual(this.accepted.handlers, next.handlers)
    ) {
      this.accepted = next;
      return;
    }

    const publication = this.frame.application.publish({ operations: next.operations }, () => {
      if (this.phase === 'active') {
        this.accepted = next;
      }
    });

    this.pending.set(publication, next);
    this.lastPublication = publication;

    void publication.then(
      () => {
        this.pending.delete(publication);
        this.resumeDeferred();
      },
      (error) => {
        this.pending.delete(publication);

        if (!this.frame.application.isClosed) {
          this.frame.reportError(error);
        }
      }
    ).catch(() => {});
  }

  private resumeDeferred(): void {
    if (this.needsUpdate && this.phase === 'active' && !this.frame.application.isClosed) {
      this.needsUpdate = false;
      this.frame.application.run(() => invalidateEntity(this.frame.owner.id));
    }
  }

  private createChildren(children: readonly NativeChild[]): NativeView[] {
    const sources = new Set<number>();
    const segments = new Set<string>();

    return children.map((descriptor) => {
      const source = this.template.nodes[descriptor.source];

      if (
        source?.node.kind !== 'comment' ||
        sources.has(descriptor.source) ||
        descriptor.segment.length === 0 ||
        descriptor.segment.includes('/') ||
        segments.has(descriptor.segment)
      ) {
        throw new HostError(
          'invalidChildRegion',
          'A nested component requires unique native region and owner addresses',
        );
      }

      sources.add(descriptor.source);
      segments.add(descriptor.segment);

      return descriptor.create({
        application: this.frame.application,
        owner: {
          id: `${this.frame.owner.id}/${descriptor.segment}`,
          generation: this.frame.owner.generation,
        },
        parent: this.frame.owner.id,
        reportError: this.frame.reportError,
        mountTarget: {
          kind: 'region',
          source: {
            owner: this.frame.owner,
            source: descriptor.source,
          },
        },
      });
    });
  }

  private viewFor(source: SourceReference): NativeView | undefined {
    if (
      source.owner.id === this.frame.owner.id &&
      source.owner.generation === this.frame.owner.generation &&
      this.template.nodes[source.source] !== undefined
    ) {
      return this;
    }

    for (const childView of this.children) {
      const match = childView.viewFor(source);

      if (match) {
        return match;
      }
    }

    return undefined;
  }

  private snapshot(): Snapshot {
    const result: Snapshot = {
      operations: [], texts: new Map(), attributes: new Map(), handlers: new Map(),
    };

    // Union accepted and admitted attributes. Full next snapshots must remove
    // an attribute introduced by an earlier still-pending batch, even if it
    // was absent from the last accepted scene. Refusal never adopts handlers.
    const previous = [this.accepted, ...this.pending.values()].filter((value) => value !== undefined);
    // Compare only with a known accepted baseline. Pending snapshots still
    // publish complete values so a predecessor cannot change the comparison.
    const baseline = this.pending.size === 0 ? this.accepted : undefined;

    for (const step of this.evaluate()) {
      const target = { owner: this.frame.owner, source: step.source };

      if (step.kind === 'text') {
        const value = textValue(step.value);
        result.texts.set(step.source, value);
        if (baseline?.texts.get(step.source) !== value) {
          result.operations.push({ op: 'text', target, value });
        }

        continue;
      }

      const node = this.template.nodes[step.source]?.node;

      if (node?.kind !== 'element') {
        throw new HostError('invalidSource', 'Attribute source is not an element');
      }

      const html = node.name.namespace !== 'http://www.w3.org/2000/svg';
      const values = step.value as Record<string, unknown>;
      const attributes = new Map<string, string>();
      const handlers = new Map<string, (event: unknown) => unknown>();

      for (const [name, value] of Object.entries(values)) {
        if (name === 'ref' && value != null) {
          throw new HostError('unsupportedRef', 'Native ref handle emission is not available yet');
        }

        if (name === 'key' || name === 'children' || name === 'ref') {
          continue;
        }

        if ((/^on[A-Z]/).test(name)) {
          if (value != null && name !== 'onClick' && name !== 'onClickCapture') {
            throw new HostError('unsupportedEvent', `Native event '${name}' requires its platform/default integration`);
          }
          if (typeof value === 'function') {
            handlers.set(name, value as (event: unknown) => unknown);
          }

          continue;
        }

        if (name === 'innerHTML') {
          throw new HostError('unsupportedMarkup', 'Native innerHTML requires owned markup emission');
        }

        if (name === 'style' && value != null && typeof value !== 'string') {
          throw new HostError('unsupportedStyleValue', 'Native style objects require shared style normalization; CSS strings are supported');
        }

        const mapped = jsxAttributeName(name, html);
        const attribute = html ? mapped.toLowerCase() : mapped;
        let normalized: string | null;

        if (name === 'class' || name === 'className') {
          normalized = classValue(value);
        } else if (value == null || value === false && !isAriaAttribute(attribute)) {
          normalized = null;
        } else normalized = value === true && html && isHtmlBooleanAttribute(attribute) ? '' : String(value);

        if (normalized !== null) {
          attributes.set(attribute, normalized);
        }
      }

      const known = new Set(previous.flatMap((snapshot) => [...(snapshot!).attributes.get(step.source)?.keys() ?? []]));

      for (const name of known) {
        if (!attributes.has(name)) {
          result.operations.push({
            op: 'removeAttribute',
            target,
            name: { namespace: '', local: name }
          });
        }
      }

      for (const [name, value] of attributes) {
        if (baseline?.attributes.get(step.source)?.get(name) === value) {
          continue;
        }
        result.operations.push({
          op: 'setAttribute',
          target,
          name: { namespace: '', local: name },
          value
        });
      }

      result.attributes.set(step.source, attributes);
      result.handlers.set(step.source, handlers);
    }

    return result;
  }
}

function handlersEqual(
  left: ReadonlyMap<number, ReadonlyMap<string, (event: unknown) => unknown>>,
  right: ReadonlyMap<number, ReadonlyMap<string, (event: unknown) => unknown>>,
): boolean {
  if (left.size !== right.size) {
    return false;
  }

  for (const [source, leftHandlers] of left) {
    const rightHandlers = right.get(source);

    if (rightHandlers === undefined || leftHandlers.size !== rightHandlers.size) {
      return false;
    }

    for (const [name, handler] of leftHandlers) {
      if (rightHandlers.get(name) !== handler) {
        return false;
      }
    }
  }

  return true;
}

export function createView(
  frame: NativeFrame,
  template: Template,
  evaluate: () => readonly EvaluatedStep[],
  children: readonly NativeChild[] = [],
): NativeView {
  return new NativeView(frame, template, evaluate, children);
}
