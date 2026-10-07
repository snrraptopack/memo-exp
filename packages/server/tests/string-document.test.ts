/**
 * StringDocument tree operations are differentially tested against a real
 * DOM: every random append/insert/remove/fragment/move sequence must leave
 * identical structure and identical parent/sibling pointers in both trees.
 */
import { describe, expect, it } from 'vitest';
import {
  StringDocument,
  type StringRenderableNode,
} from '../src/string-document';

interface TreeNode {
  nodeType: number;
  parentNode: TreeNode | null;
  firstChild: TreeNode | null;
  lastChild: TreeNode | null;
  previousSibling: TreeNode | null;
  nextSibling: TreeNode | null;
  appendChild(child: TreeNode): TreeNode;
  insertBefore(child: TreeNode, ref: TreeNode | null): TreeNode;
  removeChild(child: TreeNode): TreeNode;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function describeTree(node: TreeNode, ids: Map<TreeNode, number>): string {
  const id = ids.get(node) ?? -1;
  let out = `${id}(`;
  let previous: TreeNode | null = null;
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    if (child.parentNode !== node) out += '!parent';
    if (child.previousSibling !== previous) out += '!previous';
    previous = child;
    out += describeTree(child, ids);
  }
  if (node.lastChild !== previous) out += '!last';
  return `${out})`;
}

function childrenOf(node: TreeNode): TreeNode[] {
  const children: TreeNode[] = [];
  for (let child = node.firstChild; child !== null; child = child.nextSibling) {
    children.push(child);
  }
  return children;
}

function runScenario(seed: number, steps: number): void {
  const random = seededRandom(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)]!;
  const stringDocument = new StringDocument();
  const pairs: Array<{ dom: TreeNode; str: TreeNode }> = [];
  const domIds = new Map<TreeNode, number>();
  const strIds = new Map<TreeNode, number>();
  const create = (kind: 'element' | 'text' | 'comment' | 'fragment') => {
    const make = (doc: Document | StringDocument): TreeNode => (
      kind === 'element'
        ? doc.createElement('div')
        : kind === 'text'
          ? doc.createTextNode('t')
          : kind === 'comment'
            ? doc.createComment('c')
            : doc.createDocumentFragment()
    ) as unknown as TreeNode;
    const pair = { dom: make(document), str: make(stringDocument) };
    domIds.set(pair.dom, pairs.length);
    strIds.set(pair.str, pairs.length);
    pairs.push(pair);
    return pair;
  };
  const roots = [create('element'), create('element'), create('fragment')];
  const containers = () => pairs.filter(pair =>
    pair.dom.nodeType === 1 || pair.dom.nodeType === 11);
  const pairOf = (dom: TreeNode) => pairs[domIds.get(dom)!]!;
  const inSubtree = (root: TreeNode, candidate: TreeNode): boolean => {
    for (let node: TreeNode | null = candidate; node !== null; node = node.parentNode) {
      if (node === root) return true;
    }
    return false;
  };

  for (let step = 0; step < steps; step++) {
    const operation = random();
    const parent = pick(containers());
    if (operation < 0.45) {
      // Insert a new or existing node (moves across parents), or a fragment.
      const kind = random();
      const fragmentPair = kind < 0.15 ? create('fragment') : undefined;
      if (fragmentPair !== undefined) {
        const count = Math.floor(random() * 4);
        for (let index = 0; index < count; index++) {
          const child = create(random() < 0.5 ? 'element' : 'text');
          fragmentPair.dom.appendChild(child.dom);
          fragmentPair.str.appendChild(child.str);
        }
      }
      const movable = pairs.filter(pair =>
        pair.dom.nodeType !== 11 && !roots.includes(pair));
      const node = fragmentPair ??
        (kind < 0.5 && movable.length > 0
          ? pick(movable)
          : create(pick(['element', 'text', 'comment'] as const)));
      if (inSubtree(node.dom, parent.dom)) continue;
      const siblings = childrenOf(parent.dom);
      const ref = random() < 0.3 || siblings.length === 0 ? null : pick(siblings);
      if (ref === node.dom) continue;
      const refPair = ref === null ? null : pairOf(ref);
      parent.dom.insertBefore(node.dom, ref);
      parent.str.insertBefore(node.str, refPair?.str ?? null);
    } else if (operation < 0.75) {
      const siblings = childrenOf(parent.dom);
      // Re-append an existing child (reorder) or a fresh node.
      const node = siblings.length === 0 ? create('element') : pairOf(pick(siblings));
      parent.dom.appendChild(node.dom);
      parent.str.appendChild(node.str);
    } else {
      const siblings = childrenOf(parent.dom);
      if (siblings.length === 0) continue;
      const child = pairOf(pick(siblings));
      parent.dom.removeChild(child.dom);
      parent.str.removeChild(child.str);
    }

    let actual = '';
    let expected = '';
    for (const pair of pairs) {
      const domParent = pair.dom.parentNode;
      if (pair.str.parentNode !== (domParent === null ? null : pairOf(domParent).str)) {
        actual += `!owner${strIds.get(pair.str)}`;
      }
      if (domParent !== null) continue;
      actual += describeTree(pair.str, strIds);
      expected += describeTree(pair.dom, domIds);
    }
    if (actual !== expected) {
      expect({ seed, step, tree: actual }).toEqual({ seed, step, tree: expected });
    }
  }
}

describe('StringDocument tree operations', () => {
  it('matches DOM structure and pointers across random mutation sequences', () => {
    for (let seed = 1; seed <= 30; seed++) runScenario(seed, 80);
  }, 30_000);

  it('transfers fragment children in order and empties the fragment', () => {
    const doc = new StringDocument();
    const host = doc.createElement('ul') as unknown as StringRenderableNode;
    const tail = doc.createComment('tail') as unknown as StringRenderableNode;
    host.appendChild(tail);
    const fragment = doc.createDocumentFragment() as unknown as StringRenderableNode;
    for (const label of ['a', 'b', 'c']) {
      const item = doc.createElement('li') as unknown as StringRenderableNode;
      item.appendChild(doc.createTextNode(label) as unknown as StringRenderableNode);
      fragment.appendChild(item);
    }
    host.insertBefore(fragment, tail);
    expect(fragment.firstChild).toBeNull();
    expect(fragment.lastChild).toBeNull();
    expect(host.toString(true)).toBe('<ul><li>a</li><li>b</li><li>c</li><!--tail--></ul>');
    expect(host.lastChild).toBe(tail);
  });

  it('detaches previous children when textContent is replaced', () => {
    const doc = new StringDocument();
    const host = doc.createElement('p') as unknown as StringRenderableNode & {
      textContent: string;
    };
    const old = doc.createElement('b') as unknown as StringRenderableNode;
    host.appendChild(old);
    host.textContent = 'fresh';
    expect(old.parentNode).toBeNull();
    expect(host.firstChild).toBe(host.lastChild);
    expect(host.toString(false)).toBe('<p>fresh</p>');
  });

  it('serializes large lists in linear time', () => {
    const render = (rows: number): number => {
      const doc = new StringDocument();
      const start = performance.now();
      const body = doc.createElement('tbody') as unknown as StringRenderableNode;
      const anchor = doc.createComment('/mmd') as unknown as StringRenderableNode;
      body.appendChild(anchor);
      for (let index = 0; index < rows; index++) {
        const row = doc.createElement('tr') as unknown as StringRenderableNode;
        row.appendChild(doc.createTextNode(String(index)) as unknown as StringRenderableNode);
        body.insertBefore(row, anchor);
      }
      body.toString(true);
      return performance.now() - start;
    };
    render(2_000);
    const small = Math.max(render(5_000), 0.5);
    const large = render(50_000);
    // 10x the rows must stay well below the 100x a quadratic tier costs.
    expect(large / small).toBeLessThan(40);
  });
});

describe('StringDocument HTML serialization', () => {
  function element(doc: StringDocument, tag: string, ...children: (string | StringRenderableNode)[]) {
    const node = doc.createElement(tag) as unknown as StringRenderableNode;
    for (const child of children) {
      node.appendChild(typeof child === 'string'
        ? doc.createTextNode(child) as unknown as StringRenderableNode
        : child);
    }
    return node;
  }

  it('writes raw text elements unescaped while keeping their end tag unforgeable', () => {
    const doc = new StringDocument();
    expect(element(doc, 'style', 'main > p::after { content: "&" }').toString(false))
      .toBe('<style>main > p::after { content: "&" }</style>');
    expect(element(doc, 'style', 'a{content:"</STYLE><b>"}').toString(false))
      .toBe('<style>a{content:"\\3C /STYLE><b>"}</style>');
    expect(element(doc, 'script', 'if (a < b && c > d) run("</script><img>", "<!--")').toString(false))
      .toBe('<script>if (a < b && c > d) run("\\u003C/script><img>", "\\u003C!--")</script>');
    expect(element(doc, 'title', 'a < b & c').toString(false)).toBe('<title>a &lt; b &amp; c</title>');
  });

  it('marks the option matching a select value as selected', () => {
    const doc = new StringDocument();
    const option = (value: string | null, text: string) => {
      const node = element(doc, 'option', text);
      if (value !== null) (node as unknown as Element).setAttribute('value', value);
      return node;
    };
    const stale = option('a', 'A');
    (stale as unknown as HTMLOptionElement).selected = true;
    const select = element(doc, 'select', stale, element(doc, 'optgroup', option('b', 'B')), option(null, ' C '));
    (select as unknown as HTMLSelectElement).value = 'b';
    expect(select.toString(false)).toBe(
      '<select><option value="a">A</option><optgroup><option value="b" selected>B</option></optgroup><option> C </option></select>',
    );
    expect((select as unknown as HTMLSelectElement).value).toBe('b');
    (select as unknown as HTMLSelectElement).value = 'C';
    expect(select.toString(false)).toContain('<option selected> C </option>');
  });
});
