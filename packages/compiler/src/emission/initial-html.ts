/** HTML backend for the closed initial-content plan; no runtime or authored JS. */
import type { InitialRenderNode, InitialRenderPlan } from '../planning/initial-render';
import { UNSAFE_TAGS, VOID_TAGS, parserClosesAncestor } from '../planning/html-shape';
import { domPropertyName } from '../jsx/dom-attributes';

function escape(value: string, attribute = false): string {
  const text = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return attribute ? text.replace(/"/g, '&quot;') : text;
}

/** null means the HTML parser cannot preserve the planned DOM shape safely. */
export function emitInitialHtml(plan: InitialRenderPlan): string | null {
  if (plan.kind === 'browser' || plan.kind === 'request') return null;
  function emit(nodes: readonly InitialRenderNode[], ancestors: string[]): string | null {
    let html = '';
    for (const node of nodes) {
      if (node.kind==='component') {
        const children=emit(node.children,ancestors);
        if (children===null)return null;
        html+=children;continue;
      }
      if (node.kind === 'list') {
        const rows = emit(node.rows.flat(), ancestors);
        if (rows === null) return null;
        html += `<!--mmd:initial:list:${node.site}-->${rows}<!--/mmd:initial:list-->`;
        continue;
      }
      if (node.kind === 'conditional') {
        if (node.alternatives?.some(nodes => emit(nodes, ancestors) === null)) return null;
        const children = emit(node.children, ancestors);
        if (children === null) return null;
        html += `<!--mmd:initial:when:${node.site}-->${children}<!--/mmd:initial:when-->`;
        continue;
      }
      if (node.kind === 'browser') {
        html += `<!--mmd:initial:${node.id}-->`;
        continue;
      }
      if (node.kind === 'text') {
        // HTML parsing normalizes CR and replaces NUL; keep such content on
        // the DOM creation path until the backend can preserve it exactly.
        if (/[\r\0]/.test(node.value)) return null;
        html += plan.kind === 'bindings' && node.value === '' ? '<!--mmd:empty-->' : escape(node.value);
        continue;
      }
      const tag = node.tag;
      if (UNSAFE_TAGS.has(tag) || tag.includes('-') || parserClosesAncestor(tag, ancestors) ||
          !/^[a-z][a-z0-9]*$/.test(tag) || VOID_TAGS.has(tag) && node.children.length) return null;
      const children = emit(node.children, [...ancestors, tag]);
      if (children === null) return null;
      const normalized = new Map<string, string>();
      const type=node.attributes.find(attribute=>attribute.name.toLowerCase()==='type')?.value;
      for (const { name, value } of node.attributes) {
        // Keep property/style semantics in the backend, separate from the
        // authored, ordered host attributes carried by the content plan.
        if (name==='value' && tag==='input' && plan.kind==='bindings') {
          // Text-like input values have a parser representation. Binding also
          // restores property-only defaults and dirty-value state; HTML alone
          // cannot preserve native reset behavior for an authored IDL write.
          if (type!==undefined && (typeof type!=='string' || !['text','search','email','url','password','tel'].includes(type.toLowerCase()))) return null;
          normalized.set('value',value==null?'':String(value));
          continue;
        }
        if (name === 'style' || domPropertyName(name, false) !== null) return null;
        if (name === 'class' || name === 'className') {
          if (value != null && typeof value !== 'string') return null;
          normalized.set('class', value?.trim() ?? '');
          continue;
        }
        const mapped = (name === 'htmlFor' ? 'for' : name).toLowerCase();
        if (!/^[a-zA-Z_][\w:.-]*$/.test(mapped)) return null;
        if (value == null) { normalized.delete(mapped); continue; }
        if (typeof value !== 'string' && typeof value !== 'number') return null;
        normalized.set(mapped, String(value));
      }
      let attributes = '';
      for (const [name, value] of normalized) {
        if (/[\r\0]/.test(value)) return null;
        attributes += ` ${name}="${escape(value, true)}"`;
      }
      html += `<${tag}${attributes}>${children}${VOID_TAGS.has(tag) ? '' : `</${tag}>`}`;
    }
    return html;
  }
  return emit(plan.nodes, []);
}
