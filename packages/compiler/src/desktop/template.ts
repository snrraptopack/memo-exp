/**
 * Lower shared JSX plans to immutable native source addresses.
 *
 * This is presentation lowering, not another semantic scan or reactive engine.
 * Expressions stay in ordered steps for the emitter to evaluate in their real
 * component closure. No authored code runs while constructing a template.
 */
import * as b from '../ast/factory';
import { cloneNode } from '../ast';
import { nodeHasJsx } from '../context/ast';
import { planOrderedAttributes } from '../jsx/attributes';
import { planDirectChildren, type JsxNode } from '../jsx/children';
import { isSvgElement, SVG_NAMESPACE } from '../jsx/namespaces';
import { templateEvents } from './events';
import type {
  HostEvaluationStep,
  HostRegionStep,
  NativeSourceTemplate,
  NativeTemplateInputs,
  NativeTemplatePlan,
} from './template-plan';

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

export function lowerNativeTemplate(inputs: NativeTemplateInputs): NativeTemplatePlan {
  if (inputs.key.length === 0) {
    inputs.fail('Native template requires a stable nonempty key', inputs.jsx);
  }

  const nodes: NativeSourceTemplate['nodes'][number][] = [];
  const steps: HostEvaluationStep[] = [];
  const events: NativeTemplatePlan['events'][number][] = [];
  const refs: NativeTemplatePlan['refs'][number][] = [];

  function append(parent: number | null, node: NativeSourceTemplate['nodes'][number]['node']): number {
    const source = nodes.length;

    // Wire templates are immutable values. AST steps remain separate so the
    // later emitter can rewrite cloned reads/writes without changing topology.
    nodes.push(Object.freeze({ parent, node: Object.freeze(node) }));

    return source;
  }

  function region(
    parent: number | null,
    inSvg: boolean,
    content: HostRegionStep['content'],
  ): void {
    const source = append(parent, { kind: 'comment', value: 'memo:region' });
    steps.push({ kind: 'region', source, inSvg, content });
  }

  function children(node: JsxNode, parent: number | null, inSvg: boolean): void {
    const plan = planDirectChildren(node.children, {
      isForwarded: inputs.isForwarded,
      fail: message => inputs.fail(message, node),
    });

    for (const child of plan) {
      if (child.type === 'node') {
        lower(child.node, parent, inSvg);
      } else if (child.type === 'text') {
        if (nodeHasJsx(child.expression)) {
          inputs.fail('JSX-valued text needs shared source normalization before template lowering', child.expression);
        }

        if (b.isStringLiteral(child.expression)) {
          append(parent, { kind: 'text', value: child.expression.value });
        } else {
          const source = append(parent, { kind: 'text', value: '' });
          steps.push({
            kind: 'text',
            source,
            expression: child.expression,
            sources: inputs.expressionSources.sourcesFor(child.expression),
          });
        }
      } else {
        // Keep the shared list/conditional/forwarded-content plan intact. The
        // structural emitter owns its factories, keys and accepted generation.
        region(parent, inSvg, child);
      }
    }
  }

  function lower(node: JsxNode, parent: number | null, inSvg: boolean): void {
    if (b.isJSXFragment(node)) {
      children(node, parent, inSvg);
      return;
    }

    const opening = node.openingElement;
    const name = opening.name;

    if (b.isJSXNamespacedName(name)) {
      inputs.fail('Namespaced JSX tag spelling requires an explicit resolved namespace', name);
    }

    if (!b.isJSXIdentifier(name) || !/^[a-z]/.test(name.name)) {
      // Components and dynamic tags are resolved by the shared source graph.
      // Never fabricate an HTML tag from a member expression or source binding.
      region(parent, inSvg, { type: 'component', node: cloneNode(node) });
      return;
    }

    const svg = isSvgElement(name.name, inSvg);
    const source = append(parent, {
      kind: 'element',
      name: Object.freeze({ namespace: svg ? SVG_NAMESPACE : HTML_NAMESPACE, local: name.name }),
      attributes: Object.freeze([] as const),
    });
    const attributes = planOrderedAttributes(opening.attributes, {
      fail: message => inputs.fail(message, opening),
    });

    if (attributes.entries.length > 0) {
      // Even literal attributes join the same ordered program. Lifting a later
      // literal into the template could incorrectly beat an earlier spread.
      steps.push({
        kind: 'attributes',
        source,
        plan: attributes,
        sources: attributes.entries.map(entry => inputs.expressionSources.sourcesFor(entry.value)),
      });
      events.push(...templateEvents(source, attributes));

      for (let entry = 0; entry < attributes.entries.length; entry++) {
        const attribute = attributes.entries[entry]!;

        if (attribute.type === 'attribute' && attribute.name === 'ref') {
          refs.push({ source, entry });
        }
      }
    }

    children(node, source, svg && name.name !== 'foreignObject');
  }

  lower(inputs.jsx, null, inputs.inSvg ?? false);

  return {
    template: Object.freeze({ key: inputs.key, nodes: Object.freeze(nodes) }),
    steps: Object.freeze(steps),
    events: Object.freeze(events),
    refs: Object.freeze(refs),
  };
}
