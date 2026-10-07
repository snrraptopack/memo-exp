/**
 * stream-regions.ts — out-of-order region streaming.
 *
 * After the shell is sent, the request render keeps running. Every pending
 * data read sits inside a compiler-owned marker range (`mmd:g`, `mmd:c`,
 * `mmd:l`), so each settlement re-serializes those ranges and sends the ones
 * that changed, outermost first, as `<template>` chunks in completion order.
 * An inline script patches them into place before the browser program mounts;
 * afterwards the mounted root owns its DOM and only receives the data.
 */

import type { SerializedDataState, SerializedSourceRecord } from '@memoized-dom/data';
import { escapeJsonForScriptTag } from './json-script';
import type { StringRenderableNode } from './string-document';

const RANGE_OPEN = /^mmd:([cgl]):(.+)$/;
const PAIRED_OPEN = /^mmd:[rcgl]:/;

interface MarkerRange {
  readonly id: string;
  readonly open: StringRenderableNode;
  readonly close: StringRenderableNode;
}

export interface ChangedRegion {
  readonly id: string;
  readonly html: string;
}

function commentData(node: StringRenderableNode): string | null {
  return node.nodeType === 8 ? (node as unknown as { data: string }).data : null;
}

function closeOf(open: StringRenderableNode): StringRenderableNode | null {
  let depth = 0;
  for (let node = open.nextSibling; node !== null; node = node.nextSibling) {
    const data = commentData(node);
    if (data === null) continue;
    if (PAIRED_OPEN.test(data)) depth++;
    else if (data === '/mmd') {
      if (depth === 0) return node;
      depth--;
    }
  }
  return null;
}

/** Outermost marker ranges in [first, end), descending through ordinary nodes. */
function rangesIn(
  first: StringRenderableNode | null,
  end: StringRenderableNode | null,
  found: MarkerRange[] = [],
): MarkerRange[] {
  for (let node = first; node !== null && node !== end; node = node.nextSibling) {
    const match = RANGE_OPEN.exec(commentData(node) ?? '');
    const close = match === null ? null : closeOf(node);
    if (match !== null && close !== null) {
      found.push({ id: match[2]!, open: node, close });
      node = close;
    } else if (node.firstChild !== null) {
      rangesIn(node.firstChild, null, found);
    }
  }
  return found;
}

/** Remembers each range as last sent and reports the ones that changed. */
export class RegionTracker {
  readonly #sent = new Map<string, string>();

  constructor(
    private readonly root: StringRenderableNode,
    private readonly serialize: (node: StringRenderableNode) => string,
  ) {
    this.#record(rangesIn(root, null));
  }

  /** Changed ranges, outermost first; a sent range carries its descendants. */
  changes(): ChangedRegion[] {
    const changed: ChangedRegion[] = [];
    this.#diff(rangesIn(this.root, null), changed);
    return changed;
  }

  #html(range: MarkerRange): string {
    let html = '';
    for (let node = range.open.nextSibling; node !== null && node !== range.close; node = node.nextSibling) {
      html += this.serialize(node);
    }
    return html;
  }

  #record(ranges: readonly MarkerRange[]): void {
    for (const range of ranges) {
      this.#sent.set(range.id, this.#html(range));
      this.#record(rangesIn(range.open.nextSibling, range.close));
    }
  }

  #diff(ranges: readonly MarkerRange[], changed: ChangedRegion[]): void {
    for (const range of ranges) {
      const html = this.#html(range);
      const previous = this.#sent.get(range.id);
      if (previous === html) {
        this.#diff(rangesIn(range.open.nextSibling, range.close), changed);
        continue;
      }
      // A range the browser never received has no target; its sent parent
      // already carried it.
      if (previous !== undefined) changed.push({ id: range.id, html });
      this.#record([range]);
    }
  }
}

/** Pending outcomes the response will still deliver; the browser must not refetch them. */
export function streamedState(state: SerializedDataState): SerializedDataState {
  return {
    ...state,
    sources: state.sources.map(record => record.snapshot.status === 'pending'
      ? { ...record, snapshot: { status: 'pending', streamed: true } }
      : record),
  };
}

/** Reports source records whose snapshot differs from the last one sent. */
export class SourceDeltas {
  readonly #sent = new Map<string, string>();

  constructor(initial: SerializedDataState) {
    this.take(initial);
  }

  take(state: SerializedDataState): SerializedSourceRecord[] {
    return state.sources.filter(record => {
      const snapshot = JSON.stringify(record.snapshot);
      if (this.#sent.get(record.sourceId) === snapshot) return false;
      this.#sent.set(record.sourceId, snapshot);
      return true;
    });
  }
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function inlineScript(source: string, nonce: string | undefined): string {
  const attribute = nonce === undefined ? '' : ` nonce="${escapeAttribute(nonce)}"`;
  return `<script${attribute}>${source}</script>`;
}

/**
 * Browser half of the protocol, sent once after the shell. `__mmdS(root, ids)`
 * reads the preceding data delta, then either patches the server DOM and the
 * root's payload (before mount) or hands the data to the mounted root.
 */
const CLIENT_STREAM = `(function(){var K=Symbol.for("memoized-dom:stream");` +
  `function find(selector,attribute,value,use){var list=document.querySelectorAll(selector);` +
  `for(var i=0;i<list.length;i++)if(list[i].getAttribute(attribute)===value)return use(list[i])}` +
  `function swap(id,template){var walker=document.createTreeWalker(document,128),open,node,depth=0;` +
  `while(node=walker.nextNode())if(/^mmd:[cgl]:/.test(node.data)&&node.data.slice(6)===id){open=node;break}` +
  `if(!open)return;for(node=open.nextSibling;node;node=node.nextSibling){if(node.nodeType!==8)continue;` +
  `if(/^mmd:[rcgl]:/.test(node.data))depth++;else if(node.data==="/mmd"){if(!depth)break;depth--}}` +
  `if(!node)return;while(open.nextSibling!==node)open.parentNode.removeChild(open.nextSibling);` +
  `node.parentNode.insertBefore(template.content,node)}` +
  `function merge(root,state){find('script[type="application/mmd+json"][data-mmd-root]',"data-mmd-root",root,function(script){` +
  `var payload=JSON.parse(script.textContent),target=payload.state||(payload.state={formatVersion:1,sources:[]});` +
  `state.sources.forEach(function(record){for(var i=0;i<target.sources.length;i++)` +
  `if(target.sources[i].sourceId===record.sourceId){target.sources[i]=record;return}target.sources.push(record)});` +
  `script.textContent=JSON.stringify(payload)})}` +
  `self.__mmdS=function(root,ids){var script=document.currentScript,delta=script&&script.previousElementSibling,` +
  `api=self[K],live=!!(api&&api.owns(root)),state;` +
  `if(delta&&delta.getAttribute("data-mmd-delta")===root){state=JSON.parse(delta.textContent);delta.parentNode.removeChild(delta)}` +
  `if(state){if(live)api.deliver(root,state);else merge(root,state)}` +
  `ids.forEach(function(id){find("template[data-mmd-region]","data-mmd-region",id,function(template){` +
  `if(!live)swap(id,template);template.parentNode.removeChild(template)})});` +
  `if(script)script.parentNode.removeChild(script)};` +
  `var self_=document.currentScript;if(self_)self_.parentNode.removeChild(self_)})()`;

export function streamBootstrap(nonce: string | undefined): string {
  return inlineScript(CLIENT_STREAM, nonce);
}

/** One settlement: changed region templates, their data, and the patch call. */
export function streamChunk(
  rootId: string,
  regions: readonly ChangedRegion[],
  sources: readonly SerializedSourceRecord[],
  nonce: string | undefined,
): string {
  const root = escapeAttribute(rootId);
  let html = '';
  for (const region of regions) {
    html += `<template data-mmd-region="${escapeAttribute(region.id)}">${region.html}</template>`;
  }
  if (sources.length > 0) {
    const state: SerializedDataState = { formatVersion: 1, sources };
    html += `<script type="application/mmd+json" data-mmd-delta="${root}">` +
      `${escapeJsonForScriptTag(JSON.stringify(state))}</script>`;
  }
  const call = `__mmdS(${JSON.stringify(rootId)},${JSON.stringify(regions.map(region => region.id))})`;
  return html + inlineScript(escapeJsonForScriptTag(call), nonce);
}
