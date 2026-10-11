import { valueExpression } from './value';
/** Encode authored structure; Rust owns tag translation and content semantics. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { walkAst } from '../ast/walk';
import { unwrapTypeExpression } from '../ast/normalize';
import type { ComponentCallbacks } from '../planning/component-callbacks';
import type { ComponentExpressionSources } from '../analysis/expression-sources';
import type { DesktopDeclaration } from './css';
import { lowerDesktopAttributes } from './attributes';
import { assertNoGeneratorCallbacks, type DesktopEventType } from './events';
import type { ComponentPropsPlan } from '../components/props';
import type { LinkedComponentImport } from '../context/model';
import { desktopComponentCall } from './component-call';
import { desktopRegionPlan, desktopBranchesPlan } from './regions';
import type { ComponentReturnPlan } from '../components/return-plan';
import { nodeHasJsx } from '../context/ast';
import { matchMapCall, type MapSite } from '../lists';
import type { MapCallExpression } from '../context';
import { desktopListPlan } from './lists';
import type { ParentRow } from '../lists/map-site';
import type { HandlerWritePlan } from '../handlers/plan';
import type { CallbackSourcePlan } from '../planning/component-callbacks';
import { planDirectChildren } from '../jsx/children';

type SceneNode =
  | {
      kind: 'element';
      tag: string;
      parent: number | null;
      text: '';
      attributes: Record<string, string>;
      style: DesktopDeclaration[];
    }
  | { kind: 'text'; parent: number | null; text: string }
  | { kind: 'region'; parent: number | null; multiple?: boolean };
interface TextSlot {
  node: number;
  type: 'text' | 'value';
}

export interface DesktopFragment {
  readonly component: t.Identifier;
  readonly captures: readonly t.Identifier[];
  readonly scene: DesktopScene;
}

export interface DesktopScene {
  setup: t.Statement[];
  nodes: SceneNode[];
  slots: TextSlot[];
  events: { node: number; type: DesktopEventType }[];
  bindings: t.Expression[];
  handlers: t.Expression[];
  children: t.Expression[];
  regions: t.Expression[];
  lists: t.Expression[];
  refs: t.Expression[];
  fragments: DesktopFragment[];
  componentNames: string[];
  properties: t.Expression[];
  attributesUsed: boolean;
}

export function lowerDesktopScene(
  root: t.Node,
  options: {
    callbacks: ComponentCallbacks;
    sources: ComponentExpressionSources;
    instrument: t.Identifier;
    attributes: t.Identifier;
    scope: t.Identifier;
    lexical?: boolean;
    returns?: ComponentReturnPlan;
    parentRow?: ParentRow;
    components: ReadonlyMap<string, ComponentPropsPlan>;
    imports: ReadonlyMap<string, LinkedComponentImport>;
    fresh: (name: string) => t.Identifier;
    listSite: (call: MapCallExpression, parentRow?: ParentRow) => MapSite;
    routeWrites(plan: HandlerWritePlan): void;
    refValue(expression: t.Expression): t.Expression;
    moduleCallback(expression: t.Expression): CallbackSourcePlan | null;
    fail: (message: string, at: t.Node) => never;
  },
): DesktopScene {
  const { sources } = options;
  const fail: (message: string, at: t.Node) => never = options.fail;
  const setup: t.Statement[] = [];
  const nodes: SceneNode[] = [];
  const slots: TextSlot[] = [];
  const bindings: t.Expression[] = [];
  const events: { node: number; type: DesktopEventType }[] = [];
  const handlers: t.Expression[] = [];
  const children: t.Expression[] = [];
  const regions: t.Expression[] = [];
  const lists: t.Expression[] = [];
  const refs: t.Expression[] = [];
  const properties: t.Expression[] = [];
  let attributesUsed = false;
  const componentNames = new Set<string>();
  const fragments: DesktopFragment[] = [];
  const dependenciesFor = (expression: t.Expression): readonly string[] | null => {
    // The shared facts describe authored component locals. Fragment row locals
    // are compiler captures, so replay their reads conservatively for now.
    if (options.lexical) return null;
    let dependencies = sources.sourcesFor(expression);
    walkAst<t.Node>(expression, {
      enter(node) {
        if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression')
          dependencies = null;
      },
    });
    return dependencies;
  };
  const componentCall = (element: t.JSXElement) =>
    desktopComponentCall(element, { ...options, sourcesFor: dependenciesFor });
  const inlineCall = (
    branch: t.JSXElement | t.JSXFragment,
    captures: readonly t.Identifier[] = [],
    parentRow: ParentRow | undefined = options.parentRow,
  ) => {
    const component = options.fresh('__desktopFragment');
    const scene = lowerDesktopScene(branch, {
      ...options,
      returns: undefined,
      lexical: true,
      parentRow,
    });
    fragments.push({ component, captures, scene });
    const props = b.objectExpression(
      captures.length
        ? [b.objectProperty(b.identifier('scope'), b.callExpression(options.scope, [...captures]))]
        : [],
    );
    return { component, props, sources: null };
  };
  const addList = (call: MapCallExpression, parent: number | null): void => {
    assertNoGeneratorCallbacks(call, fail);

    // Construct each row synchronously. Async event handlers inside the row
    // remain valid; they are not part of constructing its scene.
    const callback = call.arguments[0];
    if (callback) {
      const factory = unwrapTypeExpression(callback);
      if (
        (b.isArrowFunctionExpression(factory) || b.isFunctionExpression(factory)) &&
        factory.async
      ) {
        fail('asynchronous callbacks cannot construct desktop list rows', factory);
      }
    }
    const plan = desktopListPlan(options.listSite(call, options.parentRow), {
      call: componentCall,
      inline: inlineCall,
      fresh: options.fresh,
      fail,
      sourcesFor: dependenciesFor,
    });
    const node = nodes.length;
    nodes.push({ kind: 'region', parent, multiple: true });
    componentNames.add(plan.component.name);
    lists.push(
      b.objectExpression([
        b.objectProperty(b.identifier('node'), b.numericLiteral(node)),
        b.objectProperty(b.identifier('sources'), valueExpression(plan.sources)),
        b.objectProperty(b.identifier('component'), plan.component),
        b.objectProperty(b.identifier('read'), plan.read),
      ]),
    );
  };
  const addRegion = (
    expression: t.ConditionalExpression | t.LogicalExpression,
    parent: number | null,
  ): void => {
    const plan = desktopRegionPlan(expression, {
      call: componentCall,
      inline: inlineCall,
      sourcesFor: dependenciesFor,
      fresh: options.fresh,
      fail,
    });
    addPlannedRegion(plan, parent);
  };
  const addPlannedRegion = (
    plan: ReturnType<typeof desktopRegionPlan>,
    parent: number | null,
  ): void => {
    const node = nodes.length;
    nodes.push({ kind: 'region', parent });
    for (const choice of plan.choices) if (b.isIdentifier(choice)) componentNames.add(choice.name);
    regions.push(
      b.objectExpression([
        b.objectProperty(b.identifier('node'), b.numericLiteral(node)),
        b.objectProperty(b.identifier('sources'), valueExpression(plan.sources)),
        b.objectProperty(b.identifier('branches'), b.arrayExpression(plan.choices)),
        b.objectProperty(b.identifier('read'), plan.read),
      ]),
    );
  };

  const addText = (text: string, parent: number | null): number => {
    const node = nodes.length;
    nodes.push({ kind: 'text', parent, text });
    return node;
  };
  const addBinding = (expression: t.Expression, node: number, type: TextSlot['type']): void => {
    if (nodeHasJsx(expression)) fail('structural expressions are not implemented yet', expression);
    if (
      [
        'ObjectExpression',
        'ArrayExpression',
        'ArrowFunctionExpression',
        'FunctionExpression',
      ].includes(expression.type)
    )
      fail('text/value expressions require primitive results', expression);
    // Call arguments may contain predicates and conditional scalar expressions.
    // The resulting value is still checked by the runtime's primitive slot contract.
    assertNoGeneratorCallbacks(expression, fail);
    const slot = slots.length;
    slots.push({ node, type });
    const dependencies = dependenciesFor(expression);
    bindings.push(
      b.objectExpression([
        b.objectProperty(b.identifier('slot'), b.numericLiteral(slot)),
        b.objectProperty(b.identifier('sources'), valueExpression(dependencies)),
        b.objectProperty(b.identifier('read'), b.arrowFunctionExpression([], expression)),
      ]),
    );
  };
  const emit = (element: t.Node, parent: number | null): void => {
    const map = matchMapCall(element);
    if (map && nodeHasJsx(element)) {
      addList(map, parent);
      return;
    }
    if (b.isConditionalExpression(element) || b.isLogicalExpression(element)) {
      addRegion(element, parent);
      return;
    }
    if (b.isJSXFragment(element)) {
      emitChildren(element.children, parent);
      return;
    }
    if (b.isJSXText(element)) {
      if (element.value !== '') addText(element.value, parent);
      return;
    }
    if (b.isJSXExpressionContainer(element)) {
      const expression = unwrapTypeExpression(element.expression);
      if (b.isJSXEmptyExpression(expression)) return;
      const map = matchMapCall(expression);
      if (map && nodeHasJsx(expression)) {
        addList(map, parent);
        return;
      }
      if (
        (b.isConditionalExpression(expression) || b.isLogicalExpression(expression)) &&
        nodeHasJsx(expression)
      ) {
        addRegion(expression, parent);
        return;
      }
      addBinding(expression as t.Expression, addText('', parent), 'text');
      return;
    }
    if (!b.isJSXElement(element)) fail('unsupported JSX child', element);
    const opening = element.openingElement;
    if (!b.isJSXIdentifier(opening.name))
      fail('expected a normalized finite JSX tag selection', opening);
    const tag = opening.name.name;
    if (!/^[a-z][a-z0-9-]*$/.test(tag)) {
      const call = componentCall(element);
      componentNames.add(call.component.name);
      const node = nodes.length;
      nodes.push({ kind: 'region', parent });
      children.push(
        b.objectExpression([
          b.objectProperty(b.identifier('node'), b.numericLiteral(node)),
          b.objectProperty(b.identifier('sources'), valueExpression(call.sources)),
          b.objectProperty(b.identifier('component'), call.component),
          b.objectProperty(b.identifier('read'), b.arrowFunctionExpression([], call.props)),
        ]),
      );
      return;
    }
    const node = nodes.length;
    const emitted = lowerDesktopAttributes(
      opening,
      tag,
      node,
      { events, handlers, refs, properties, setup },
      {
        ...options,
        addValue: (expression, node) => addBinding(expression, node, 'value'),
      },
    );
    attributesUsed ||= emitted.attributesUsed;
    nodes.push({
      kind: 'element',
      tag,
      parent,
      text: '',
      attributes: emitted.attributes,
      style: emitted.style,
    });
    emitChildren(element.children, node);
  };
  const emitChildren = (children: t.JSXElement['children'], parent: number | null): void => {
    const plan = planDirectChildren(children, {
      preserveTextBoundaries: true,
      cloneExpressions: false,
      isForwarded: () => false,
      fail: (message) => fail(message, root),
    });
    for (const child of plan) {
      switch (child.type) {
        case 'text':
          if (child.static && b.isStringLiteral(child.expression))
            addText(child.expression.value, parent);
          else addBinding(child.expression, addText('', parent), 'text');
          break;
        case 'node':
          emit(child.node, parent);
          break;
        case 'list':
          addList(child.expression, parent);
          break;
        case 'condition':
          addRegion(child.expression, parent);
          break;
        case 'slot':
          fail('forwarded JSX slots require scene ownership', child.expression);
      }
    }
  };
  if (options.returns) {
    addPlannedRegion(
      desktopBranchesPlan(
        {
          pickExpr: b.callExpression(options.returns.pick, []),
          branches: options.returns.branches,
        },
        {
          call: componentCall,
          inline: inlineCall,
          sourcesFor: dependenciesFor,
          fresh: options.fresh,
          fail,
        },
      ),
      null,
    );
  } else {
    emit(root, null);
  }
  // A component handle owns all fragment roots; regions flatten them at placement.
  if (!nodes.length) fail('empty desktop fragments are not implemented yet', root);
  return {
    setup,
    nodes,
    slots,
    events,
    bindings,
    handlers,
    children,
    regions,
    lists,
    refs,
    fragments,
    componentNames: [...componentNames],
    properties,
    attributesUsed,
  };
}
