/**
 * Phase 3 hydration cursor — read-only adoption over the v0.2 marker stream.
 *
 * The cursor never creates, moves, or removes nodes. It validates and claims
 * the server tree in compiler-defined order. Mutation/recovery belongs to the
 * mount integration layer; keeping this primitive read-only makes failed
 * adoption safe and independently testable.
 */

import type { DocumentLike } from './environment';
import {
  getActiveEnvironment,
  runWithRenderEnvironment,
} from './kernel';
import type { RootFactoryDefinition } from './mount';
export { HydrationMismatchError } from './hydration-error';
import { HydrationMismatchError } from './hydration-error';

export type HydrationMarkerKind = 'r' | 'c' | 'g' | 'l' | 'w' | 'd';
export type PairedHydrationMarkerKind = 'r' | 'c' | 'g' | 'l';

export interface HydrationOpenMarker {
  readonly type: 'open';
  readonly kind: HydrationMarkerKind;
  readonly identity: string;
  readonly attribute?: string;
}

export interface HydrationCloseMarker {
  readonly type: 'close';
}

export type HydrationMarker = HydrationOpenMarker | HydrationCloseMarker;


export interface HydrationController {
  claimRange(
    kind: Exclude<PairedHydrationMarkerKind, 'r'>,
    identity: string,
  ): ClaimedHydrationRange;
  claimRow(listId: string, encodedKey: string): ClaimedHydrationRange;
  pushRange(range: ClaimedHydrationRange): void;
  popRange(): void;
  recordFragmentRange(parent: Node, range: ClaimedHydrationRange): void;
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
  readonly cursor: LocalHydrationCursor;
}

const PAIRED_KINDS: ReadonlySet<HydrationMarkerKind> = new Set([
  'r',
  'c',
  'g',
  'l',
]);

/** Parse one protocol comment body. Unrelated comments return null. */
export function parseHydrationMarker(data: string): HydrationMarker | null {
  if (data === '/mmd') return { type: 'close' };
  if (!data.startsWith('mmd:') || data.length < 7) return null;

  const kind = data[4];
  if (
    data[5] !== ':' ||
    (kind !== 'r' &&
      kind !== 'c' &&
      kind !== 'g' &&
      kind !== 'l' &&
      kind !== 'w' &&
      kind !== 'd')
  ) {
    return null;
  }

  const payload = data.slice(6);
  const attributeAt = payload.indexOf(' @ ');
  const identity =
    attributeAt === -1 ? payload : payload.slice(0, attributeAt);
  if (identity.length === 0 || identity.includes('>')) return null;
  const attribute =
    attributeAt === -1 ? undefined : payload.slice(attributeAt + 3);

  return {
    type: 'open',
    kind,
    identity,
    ...(attribute === undefined ? {} : { attribute }),
  };
}

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

function expectOpen(
  node: Node | null,
  kind: HydrationMarkerKind,
  identity: string,
  boundary: string,
): Comment {
  const marker = markerFor(node);
  if (
    marker?.type !== 'open' ||
    marker.kind !== kind ||
    marker.identity !== identity
  ) {
    throw new HydrationMismatchError(
      boundary,
      `<!--mmd:${kind}:${identity}-->`,
      describeNode(node),
    );
  }
  return node as Comment;
}

/** A deterministic sibling cursor bounded by one structural owner. */
export class LocalHydrationCursor {
  readonly boundary: string;
  readonly end: Node;
  #next: Node | null;

  constructor(boundary: string, first: Node | null, end: Node) {
    this.boundary = boundary;
    this.#next = first;
    this.end = end;
  }

  get nextNode(): Node | null {
    return this.#next === this.end ? null : this.#next;
  }

  get done(): boolean {
    return this.#next === this.end;
  }

  /** Claim one ordinary node and validate kind/tag/namespace in place. */
  claimNode(expectation: HydrationNodeExpectation): Node {
    const node = this.nextNode;
    if (node === null) {
      throw new HydrationMismatchError(
        this.boundary,
        nodeExpectation(expectation),
        describeNode(null),
      );
    }
    if (markerFor(node) !== null || node.nodeType !== expectation.nodeType) {
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
    this.#next = node.nextSibling;
    return node;
  }

  /** Claim the next paired component/conditional/list region. */
  claimRange(
    kind: Exclude<PairedHydrationMarkerKind, 'r'>,
    identity: string,
  ): ClaimedHydrationRange {
    const open = expectOpen(this.nextNode, kind, identity, this.boundary);
    const close = findPairClose(open, this.end, identity);
    this.#next = close.nextSibling;
    return {
      kind,
      identity,
      open,
      end: close,
      cursor: new LocalHydrationCursor(identity, open.nextSibling, close),
    };
  }

  /**
   * Claim one v0.2 single-opening row. Its exclusive end is the next row
   * marker at list depth zero or the enclosing list close.
   */
  claimRow(listId: string, encodedKey: string): ClaimedHydrationRange {
    const identity = `${listId}:${encodedKey}`;
    const open = expectOpen(this.nextNode, 'w', identity, this.boundary);
    let depth = 0;
    let end: Node = this.end;
    for (let node = open.nextSibling; node !== this.end; node = node?.nextSibling ?? null) {
      if (node === null) break;
      const marker = markerFor(node);
      if (marker?.type === 'open') {
        if (depth === 0 && marker.kind === 'w') {
          end = node;
          break;
        }
        if (PAIRED_KINDS.has(marker.kind)) depth++;
      } else if (marker?.type === 'close' && depth > 0) {
        depth--;
      }
    }
    this.#next = end;
    return {
      kind: 'w',
      identity,
      open,
      end,
      cursor: new LocalHydrationCursor(identity, open.nextSibling, end),
    };
  }

  expectDone(): void {
    if (!this.done) {
      throw new HydrationMismatchError(
        this.boundary,
        'the end of the boundary',
        describeNode(this.nextNode),
      );
    }
  }
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
export function createHydrationCursor(
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
    cursor: new LocalHydrationCursor(rootId, open.nextSibling, close),
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
      cursor: new LocalHydrationCursor(
        identity,
        range.open.nextSibling,
        range.end,
      ),
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
export class HydrationDocument
  implements DocumentLike, HydrationController
{
  readonly #fallback: DocumentLike;
  readonly #index: HydrationMarkerIndex;
  readonly #plans: HydrationNodePlan[];
  #hydrating = true;
  readonly #patchedElements: Element[] = [];

  constructor(fallback: DocumentLike, range: ClaimedHydrationRange) {
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

  pushRange(range: ClaimedHydrationRange): void {
    this.#plans.push(new HydrationNodePlan(range));
  }

  popRange(): void {
    if (this.#plans.length === 1) {
      throw new Error('memoized-dom: cannot pop the hydration root plan');
    }
    this.#plans.at(-1)!.expectDone();
    this.#plans.pop();
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
): HydratedApplicationRoot {
  const range = createHydrationCursor(host, definition.id);
  const hydrationDocument = new HydrationDocument(
    getActiveEnvironment().document,
    range,
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
      disposeMarkers() {
        range.open.parentNode?.removeChild(range.open);
        range.end.parentNode?.removeChild(range.end);
      },
    };
  } finally {
    hydrationDocument.finishHydration();
  }
}
