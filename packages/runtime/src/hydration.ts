/**
 * Hydration creation plan — read-only adoption over the v0.2 marker stream.
 *
 * Claims validate the server tree in compiler-defined order without mutation.
 * Region callers can explicitly abandon a mismatched range and create its
 * replacement; all other claims continue against the same adoption plan.
 */

import type { DocumentLike } from './environment';
import {
  getActiveEnvironment,
  runWithRenderEnvironment,
} from './kernel';
import type { RootFactoryDefinition } from './mount';
export { HydrationMismatchError } from './hydration-error';
import { HydrationMismatchError } from './hydration-error';

import {
  parseHydrationMarker,
  type HydrationMarker,
  type HydrationMarkerKind,
  type PairedHydrationMarkerKind,
} from './hydration-marker';
export { parseHydrationMarker } from './hydration-marker';
export type {
  HydrationMarker,
  HydrationMarkerKind,
  PairedHydrationMarkerKind,
  HydrationOpenMarker,
  HydrationCloseMarker,
} from './hydration-marker';

export interface HydrationController {
  claimList(parent: Node, identity: string): ClaimedHydrationList;
  claimRange(
    kind: Exclude<PairedHydrationMarkerKind, 'r'>,
    identity: string,
  ): ClaimedHydrationRange;
  claimRow(listId: string, encodedKey: string): ClaimedHydrationRange;
  pushRange(range: ClaimedHydrationRange): void;
  popRange(): void;
  recordFragmentRange(parent: Node, range: ClaimedHydrationRange): void;
  /**
   * Claim every node of a compiler-generated static markup subtree against
   * the active creation plan. Returns the claimed nodes in compiler
   * creation order (post-order — the markup root is last). Equivalent
   * validation to sequential createElement/createTextNode claims.
   */
  claimMarkup(markup: string): Node[];
  /**
   * When `error` is a hydration mismatch, discard the claimed range and run
   * `render` as a fresh client render inside it, so the rest of the root keeps
   * adopting; returns false for any other error. Callers must already have
   * released everything the failed attempt registered. Deciding here keeps
   * the mismatch type out of bundles without hydration.
   */
  recoverRange?(range: ClaimedHydrationRange, error: unknown, render: () => void): boolean;
}

/** Row validation and cursor transactions belong to the hydration host. */
export interface ClaimedHydrationList {
  readonly open: Comment;
  readonly end: Node;
  adoptRow<T>(key: unknown, encoded: string | null, create: () => T): { value: T; marker: Comment };
  finish(): void;
}
export interface HydrationNodeExpectation {
  readonly nodeType: number;
  readonly tagName?: string;
  readonly namespaceURI?: string | null;
}

export interface ClaimedHydrationRange {
  readonly kind: PairedHydrationMarkerKind | 'w';
  readonly identity: string;
  readonly open: Comment;
  /** Exclusive end: the pair close, next row marker, or enclosing list close. */
  readonly end: Node;
}

const PAIRED_KINDS: ReadonlySet<HydrationMarkerKind> = new Set([
  'r',
  'c',
  'g',
  'l',
]);

function markerFor(node: Node | null): HydrationMarker | null {
  return node?.nodeType === 8
    ? parseHydrationMarker((node as Comment).data)
    : null;
}

function describeNode(node: Node | null): string {
  if (node === null) return 'the end of the boundary';
  if (node.nodeType === 8) return `comment <!--${(node as Comment).data}-->`;
  if (node.nodeType === 1) {
    return `element <${(node as Element).localName}>`;
  }
  if (node.nodeType === 3) return 'a text node';
  return `node type ${node.nodeType}`;
}

function findPairClose(
  open: Comment,
  boundaryEnd: Node | null,
  boundary: string,
): Comment {
  let depth = 0;
  for (let node = open.nextSibling; node !== boundaryEnd; node = node?.nextSibling ?? null) {
    if (node === null) break;
    const marker = markerFor(node);
    if (marker?.type === 'open' && PAIRED_KINDS.has(marker.kind)) {
      depth++;
      continue;
    }
    if (marker?.type === 'close') {
      if (depth === 0) return node as Comment;
      depth--;
    }
  }
  throw new HydrationMismatchError(
    boundary,
    'a matching <!--/mmd--> close',
    describeNode(boundaryEnd),
  );
}

function nodeExpectation(expectation: HydrationNodeExpectation): string {
  if (expectation.nodeType === 1) {
    const tag = expectation.tagName ?? '*';
    const namespace =
      expectation.namespaceURI === undefined
        ? ''
        : ` in namespace ${String(expectation.namespaceURI)}`;
    return `element <${tag.toLowerCase()}>${namespace}`;
  }
  if (expectation.nodeType === 3) return 'a text node';
  if (expectation.nodeType === 8) return 'a comment node';
  return `node type ${expectation.nodeType}`;
}

/** Locate and validate one application-root marker pair inside a host. */
export function claimHydrationRoot(
  host: Element,
  rootId: string,
): ClaimedHydrationRange {
  let open: Comment | null = null;
  for (let node = host.firstChild; node !== null; node = node.nextSibling) {
    const marker = markerFor(node);
    if (
      marker?.type === 'open' &&
      marker.kind === 'r' &&
      marker.identity === rootId
    ) {
      if (open !== null) {
        throw new HydrationMismatchError(
          rootId,
          'one application-root marker',
          'multiple matching application-root markers',
        );
      }
      open = node as Comment;
    }
  }
  if (open === null) {
    throw new HydrationMismatchError(
      rootId,
      `<!--mmd:r:${rootId}-->`,
      'no matching application-root marker',
    );
  }
  const close = findPairClose(open, null, rootId);
  return {
    kind: 'r',
    identity: rootId,
    open,
    end: close,
  };
}

/**
 * Compiler creation order for one claimed range.
 *
 * JSX emission creates descendants before their host (`text → button →
 * section`), while DOM order stores hosts before descendants. This plan
 * performs one marker-aware post-order walk and then validates each factory
 * claim without creating or moving nodes. Nested structural ranges are
 * skipped: their cond/list/row primitive owns a separate plan.
 */
export class HydrationNodePlan {
  readonly boundary: string;
  readonly #nodes: Node[];
  #position = 0;

  constructor(range: ClaimedHydrationRange) {
    this.boundary = range.identity;
    this.#nodes = [];
    collectCreationOrder(range.open.nextSibling, range.end, this.#nodes);
  }

  get remaining(): number {
    return this.#nodes.length - this.#position;
  }

  get done(): boolean {
    return this.#position === this.#nodes.length;
  }

  /** Claim the next node in compiler creation order and validate its shape. */
  claimNode(expectation: HydrationNodeExpectation): Node {
    const node = this.#nodes[this.#position] ?? null;
    if (node === null || node.nodeType !== expectation.nodeType) {
      throw new HydrationMismatchError(
        this.boundary,
        nodeExpectation(expectation),
        describeNode(node),
      );
    }
    if (node.nodeType === 1) {
      const element = node as Element;
      if (
        (expectation.tagName !== undefined &&
          element.localName !== expectation.tagName.toLowerCase()) ||
        (expectation.namespaceURI !== undefined &&
          element.namespaceURI !== expectation.namespaceURI)
      ) {
        throw new HydrationMismatchError(
          this.boundary,
          nodeExpectation(expectation),
          describeNode(node),
        );
      }
    }
    this.#position++;
    return node;
  }

  expectDone(): void {
    if (!this.done) {
      throw new HydrationMismatchError(
        this.boundary,
        'the end of the creation plan',
        `${this.remaining} unclaimed server node(s)`,
      );
    }
  }
}

/** Marker-aware post-order DFS over [start, end). */
function collectCreationOrder(
  start: Node | null,
  end: Node | null,
  output: Node[],
): void {
  let node = start;
  while (node !== null && node !== end) {
    const marker = markerFor(node);
    if (marker?.type === 'open') {
      node =
        marker.kind === 'w'
          ? rowExtentBoundary(node as Comment, end)
          : findPairClose(node as Comment, end, marker.identity).nextSibling;
      continue;
    }
    if (marker?.type === 'close') {
      node = node.nextSibling;
      continue;
    }
    collectCreationOrder(node.firstChild, null, output);
    output.push(node);
    node = node.nextSibling;
  }
}

/** Exclusive extent boundary for a v0.2 single-opening row. */
function rowExtentBoundary(open: Comment, end: Node | null): Node | null {
  let depth = 0;
  for (
    let node = open.nextSibling;
    node !== null && node !== end;
    node = node.nextSibling
  ) {
    const marker = markerFor(node);
    if (marker?.type === 'open') {
      if (depth === 0 && marker.kind === 'w') return node;
      if (PAIRED_KINDS.has(marker.kind)) depth++;
    } else if (marker?.type === 'close') {
      if (depth === 0) return node;
      depth--;
    }
  }
  return end;
}

interface IndexedHydrationRange {
  readonly kind: Exclude<HydrationMarkerKind, 'd'>;
  readonly open: Comment;
  readonly end: Node;
  claimed: boolean;
}

/**
 * One-time identity index for nested structural marker ranges.
 *
 * Compiler creation order and DOM marker order are independent. The node
 * plan serves ordinary nodes in post-order; this index locates `c/g/l/w`
 * owners by their compiler-canonical identity regardless of when a factory
 * reaches them. It validates pair nesting while building and permits exactly
 * one claim per identity.
 */
export class HydrationMarkerIndex {
  readonly #ranges = new Map<string, IndexedHydrationRange>();

  constructor(root: ClaimedHydrationRange) {
    this.#walk(root.open.nextSibling, root.end);
  }

  get size(): number {
    return this.#ranges.size;
  }

  claimRange(
    kind: Exclude<PairedHydrationMarkerKind, 'r'>,
    identity: string,
  ): ClaimedHydrationRange {
    return this.#claim(kind, identity);
  }

  claimRow(listId: string, encodedKey: string): ClaimedHydrationRange {
    return this.#claim('w', `${listId}:${encodedKey}`);
  }

  /** Forget every range nested in a discarded range; nothing will claim them. */
  abandonWithin(range: ClaimedHydrationRange): void {
    const walk = (start: Node | null, end: Node | null): void => {
      for (let node = start; node !== null && node !== end; node = node.nextSibling) {
        const marker = markerFor(node);
        if (marker?.type === 'open') this.#ranges.delete(marker.identity);
        if (node.firstChild !== null) walk(node.firstChild, null);
      }
    };
    walk(range.open.nextSibling, range.end);
  }

  get unclaimed(): number {
    let count = 0;
    for (const range of this.#ranges.values()) {
      if (!range.claimed) count++;
    }
    return count;
  }

  #claim(
    kind: Exclude<HydrationMarkerKind, 'd' | 'r'>,
    identity: string,
  ): ClaimedHydrationRange {
    const range = this.#ranges.get(identity);
    if (range === undefined) {
      throw new HydrationMismatchError(
        identity,
        `<!--mmd:${kind}:${identity}-->`,
        'no matching marker in the server stream',
      );
    }
    if (range.kind !== kind) {
      throw new HydrationMismatchError(
        identity,
        `<!--mmd:${kind}:${identity}-->`,
        `<!--mmd:${range.kind}:${identity}-->`,
      );
    }
    if (range.claimed) {
      throw new HydrationMismatchError(
        identity,
        'one structural claim',
        'the range was already claimed',
      );
    }
    range.claimed = true;
    return {
      kind,
      identity,
      open: range.open,
      end: range.end,
    };
  }

  #walk(start: Node | null, end: Node | null): void {
    let node = start;
    while (node !== null && node !== end) {
      const marker = markerFor(node);
      if (marker?.type !== 'open') {
        if (node.nodeType === 1) this.#walk(node.firstChild, null);
        node = node.nextSibling;
        continue;
      }
      if (marker.kind === 'd') {
        node = node.nextSibling;
        continue;
      }

      let rangeEnd: Node;
      if (marker.kind === 'w') {
        rangeEnd = rowExtentBoundary(node as Comment, end) ?? end ?? node;
      } else {
        rangeEnd = findPairClose(node as Comment, end, marker.identity);
      }
      if (this.#ranges.has(marker.identity)) {
        throw new HydrationMismatchError(
          marker.identity,
          'one marker identity',
          'a duplicate identity in the server stream',
        );
      }
      this.#ranges.set(marker.identity, {
        kind: marker.kind,
        open: node as Comment,
        end: rangeEnd,
        claimed: false,
      });
      this.#walk(node.nextSibling, rangeEnd);
      if (rangeEnd === end) {
        node = end;
      } else if (
        marker.kind === 'w' &&
        rangeEnd.nodeType === 8 &&
        markerFor(rangeEnd)?.type === 'open'
      ) {
        node = rangeEnd;
      } else {
        node = rangeEnd.nextSibling;
      }
    }
  }
}

/**
 * Adoption document backed by one compiler-order node plan per structural
 * range. Runtime primitives claim their marker range through the controller
 * surface, push it for the initial factory, then pop after all ordinary
 * nodes were served.
 */
export interface HydrationCapabilities {
  readonly list?: (document: HydrationDocument, parent: Node, identity: string) => ClaimedHydrationList;
  readonly markup?: (document: HydrationDocument, markup: string) => Node[];
}

export class HydrationDocument
  implements DocumentLike, HydrationController
{
  readonly #fallback: DocumentLike;
  readonly #index: HydrationMarkerIndex;
  readonly #plans: HydrationNodePlan[];
  #hydrating = true;
  readonly #patchedElements: Element[] = [];
  readonly #recovered: HydrationMismatchError[] = [];

  constructor(fallback: DocumentLike, range: ClaimedHydrationRange, readonly capabilities: HydrationCapabilities = {}) {
    this.#fallback = fallback;
    this.#index = new HydrationMarkerIndex(range);
    this.#plans = [new HydrationNodePlan(range)];
  }

  claimRange(
    kind: Exclude<PairedHydrationMarkerKind, 'r'>,
    identity: string,
  ): ClaimedHydrationRange {
    return this.#index.claimRange(kind, identity);
  }

  claimRow(listId: string, encodedKey: string): ClaimedHydrationRange {
    return this.#index.claimRow(listId, encodedKey);
  }

  claimList(parent: Node, identity: string): ClaimedHydrationList {
    if (!this.capabilities.list) throw new HydrationMismatchError(identity, 'list adoption capability', 'an incomplete browser program');
    return this.capabilities.list(this, parent, identity);
  }

  pushRange(range: ClaimedHydrationRange): void {
    this.#plans.push(new HydrationNodePlan(range));
  }

  popRange(): void {
    if (this.#plans.length === 1) {
      throw new Error('memoized-dom: cannot pop the hydration root plan');
    }
    // Pop before validating: a recovered range must not leave its plan active.
    this.#plans.pop()!.expectDone();
  }

  recordFragmentRange(parent: Node, range: ClaimedHydrationRange): void {
    if (parent.nodeType !== 11) return;
    // Hydration fragments only record adopted children; they never move them.
    const children = (parent as DocumentFragment & {
      __mmdAdoptedChildren?: Node[];
    }).__mmdAdoptedChildren;
    if (children === undefined) return;
    for (let node: Node | null = range.open; node !== null; node = node.nextSibling) {
      children.push(node);
      if (node === range.end) return;
    }
    throw new HydrationMismatchError(
      range.identity,
      'the adopted range close',
      'the end of the parent fragment',
    );
  }

  createElement(tagName: string): Element {
    return this.#adoptElement(
      this.#activePlan().claimNode({
        nodeType: 1,
        tagName,
      }) as Element,
    );
  }

  createElementNS(namespaceURI: string, qualifiedName: string): Element {
    return this.#adoptElement(
      this.#activePlan().claimNode({
        nodeType: 1,
        tagName: qualifiedName,
        namespaceURI,
      }) as Element,
    );
  }

  createTextNode(_data: string): Text {
    return this.#activePlan().claimNode({ nodeType: 3 }) as Text;
  }

  /**
   * Markup adoption: traverse the compiler's static subtree and claim each
   * node through the active creation plan in creation order. This is
   * the hydration counterpart of materializeMarkup() — the claim sequence
   * and validation are identical to the imperative factory calls the markup
   * replaced, without constructing any real DOM. Claimed elements receive
   * the same append/insert patching as createElement claims so later
   * imperative appends stay correct.
   */
  claimMarkup(markup: string): Node[] {
    if (!this.capabilities.markup) throw new HydrationMismatchError(this.#activePlan().boundary, 'markup adoption capability', 'an incomplete browser program');
    return this.capabilities.markup(this, markup);
  }

  recoverRange(range: ClaimedHydrationRange, error: unknown, render: () => void): boolean {
    if (!(error instanceof HydrationMismatchError)) return false;
    this.#index.abandonWithin(range);
    const parent = range.open.parentNode!;
    while (range.open.nextSibling !== null && range.open.nextSibling !== range.end) {
      parent.removeChild(range.open.nextSibling);
    }
    this.#recovered.push(error);
    runWithRenderEnvironment(
      { mode: 'client-create', document: this.#fallback, hydration: undefined },
      render,
    );
    return true;
  }

  /** Mismatches that one region absorbed by rendering itself on the client. */
  get recovered(): readonly HydrationMismatchError[] {
    return this.#recovered;
  }

  createComment(data: string): Comment {
    return this.#fallback.createComment(data);
  }

  createDocumentFragment(): DocumentFragment {
    const fragment = this.#fallback.createDocumentFragment();
    const adoptedChildren: Node[] = [];
    Object.defineProperty(fragment, '__mmdAdoptedChildren', {
      value: adoptedChildren,
      configurable: true,
    });
    fragment.appendChild = <T extends Node>(node: T): T => {
      adoptedChildren.push(node);
      return node;
    };
    return fragment;
  }

  createRange(): Range {
    if (this.#fallback.createRange === undefined) {
      throw new Error(
        'memoized-dom: active hydration document does not support Range',
      );
    }
    return this.#fallback.createRange();
  }

  getElementById(id: string): Element | null {
    return this.#fallback.getElementById(id);
  }

  expectDone(): void {
    if (this.#plans.length !== 1) {
      throw new HydrationMismatchError(
        this.#plans[0]!.boundary,
        'the root plan only',
        `${this.#plans.length - 1} open structural plan(s)`,
      );
    }
    this.#activePlan().expectDone();
    if (this.#index.unclaimed > 0) {
      throw new HydrationMismatchError(
        this.#activePlan().boundary,
        'every structural range claimed',
        `${this.#index.unclaimed} unclaimed structural range(s)`,
      );
    }
  }

  /**
   * Adoption is complete — restore native DOM mutation on claimed elements so
   * post-hydration reconciliation (cond swaps, list row moves) works.
   */
  finishHydration(): void {
    this.#hydrating = false;
    for (const element of this.#patchedElements) {
      Reflect.deleteProperty(element, 'appendChild');
      Reflect.deleteProperty(element, 'insertBefore');
    }
    this.#patchedElements.length = 0;
  }

  /**
   * Claimed children already sit in authored DOM order — the node plan
   * validated that sequence. Re-appending them during adoption would rotate
   * each child to the end of its parent (structural region fragments insert
   * nothing in hydrate mode), so parent-child links are treated as already
   * established until finishHydration() runs.
   */
  #adoptElement<T extends Element>(element: T): T {
    const appendChild = element.appendChild;
    const insertBefore = element.insertBefore;
    this.#patchedElements.push(element);
    element.appendChild = <C extends Node>(node: C): C => {
      if (this.#hydrating && node.parentNode === element) return node;
      return appendChild.call(element, node) as C;
    };
    element.insertBefore = <C extends Node>(
      node: C,
      ref: Node | null,
    ): C => {
      if (this.#hydrating && node.parentNode === element) return node;
      return insertBefore.call(element, node, ref) as C;
    };
    return element;
  }

  #activePlan(): HydrationNodePlan {
    return this.#plans.at(-1)!;
  }
}

/** Server-adopted application root: the claimed top node plus marker cleanup. */
export interface HydratedApplicationRoot {
  readonly root: Node;
  /** Region mismatches recovered without discarding the root. */
  readonly recovered: readonly HydrationMismatchError[];
  disposeMarkers(): void;
}

/**
 * Adopt one server-rendered application root under a hydrate-mode document.
 * Installed into mount() by the optional '@memoized-dom/runtime/hydrate'
 * entry so applications without server markup never bundle this module.
 */
export function hydrateApplicationRoot(
  host: Element,
  definition: RootFactoryDefinition,
  capabilities: HydrationCapabilities = {},
): HydratedApplicationRoot {
  const range = claimHydrationRoot(host, definition.id);
  const hydrationDocument = new HydrationDocument(
    getActiveEnvironment().document,
    range,
    capabilities,
  );
  try {
    const root = runWithRenderEnvironment(
      {
        mode: 'hydrate',
        document: hydrationDocument,
        hydration: hydrationDocument,
      },
      () => definition.create({ mode: 'hydrate', host }),
    );
    hydrationDocument.expectDone();
    return {
      root,
      recovered: hydrationDocument.recovered,
      disposeMarkers() {
        range.open.parentNode?.removeChild(range.open);
        range.end.parentNode?.removeChild(range.end);
      },
    };
  } finally {
    hydrationDocument.finishHydration();
  }
}
