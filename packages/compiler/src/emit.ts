/**
 * emit.ts - JSX DOM nodes and structural-region emission.
 *
 *   R2  JSX → creation branch with cached node variables (post-order)
 *   R3  dynamic expressions → numbered slots with guarded setters
 *   R4  creation runs the same guarded setters (null cache → first write)
 *   R7  {items.map(item => …)} → createListRegion + row factories
 *
 * Component factory ABI and registration live in emission/component.ts.
 * Emission state is explicit (EmitScope) rather than closure-local so that
 * inline list rows can emit into a NESTED scope: an inline row is a small
 * entity factory of its own (own slots, own update, register parent=id),
 * created per item by the region.
 */

import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import {
  attrExpr,
  exprReadsState,
  nodeHasJsx,
  type Ctx,
  type RowCtx,
} from './context';
import {
  componentId,
  generatedIdentifier,
  md,
} from './identifiers';
import {
  freshNodeName,
  freshSlot,
  slotGuard,
  type EmitScope,
} from './emission/scope';
import {
  buildHandler,
  instrumentComponentCallback,
  resolveLocalHelper,
} from './handlers';
import {
  buildChildrenSlot,
  emitChildrenIntoParent,
  hasComponentChildren,
  isChildrenReference,
  type JsxChild,
} from './components/children';
import {
  collectDirectChildren,
  type DirectChildOperation,
  type JsxNode,
} from './jsx/children';
import {
  buildOrderedAttributes,
  jsxAttributeName,
} from './jsx/attributes';
import { createElementExpression, isSvgElement } from './jsx/svg';
import {
  buildSpreadComponentPropUpdate,
  callPropsFromObject,
  orderCallProps,
} from './components/calls';
import {
  buildBranchCreate as buildConditionalBranchCreate,
  emitConditionalRegion,
} from './emission/conditional-region';
import { emitListRegion } from './emission/list-region';

// ---------------------------------------------------------------------
// shared statement builders
// ---------------------------------------------------------------------

/**
 * M5.9: dynamic slots are per-scope LOCALS (`let $s0, $s1, …`), not a cache
 * object with string keys — the update closure guards inline
 * (`if ($s0 !== ($t = expr)) { $s0 = $t; …write… }`), which keeps the whole
 * row update in one inlinable function instead of N calls × string lookups.
 */
/**
 * The inline guarded write shared by every dynamic slot:
 * `if ($sK !== ($t = EXPR)) { $sK = $t; WRITE($t) }` — used for BOTH the
 * creation and the update branch: a fresh slot (undefined) never equals a
 * legit first value except undefined/null/boolean, and for those the
 * freshly-created DOM node already holds exactly what the write would set
 * (empty text data, empty className, absent attribute).
 */
/** The value-normalization shared by text semantics: null/undefined/bool → ''. */
function textValue(tmp: t.Identifier): t.Expression {
  return t.conditionalExpression(
    t.logicalExpression(
      '||',
      t.binaryExpression('==', t.cloneNode(tmp), t.nullLiteral()),
      t.binaryExpression(
        '===',
        t.unaryExpression('typeof', t.cloneNode(tmp), true),
        t.stringLiteral('boolean'),
      ),
    ),
    t.stringLiteral(''),
    t.callExpression(t.identifier('String'), [t.cloneNode(tmp)]),
  );
}

// ---------------------------------------------------------------------
// component transform
// ---------------------------------------------------------------------

/**
 * M5.8: attributes that are really DOM IDL properties — written via
 * setProp (el.x = v) instead of setAttribute. Conservative set: boolean
 * and value-bearing properties where the attribute form is only a
 * DEFAULT (checked, value, …), never reflective state we should stomp.
 */
const DOM_PROP_ATTRS = new Set([
  'innerHTML',
  'checked',
  'value',
  'selected',
  'disabled',
  'hidden',
  'multiple',
  'required',
  'readOnly',
  'muted',
  'open',
  'controls',
  'loop',
  'autoFocus',
  'autoPlay',
  'tabIndex',
]);
const DOM_MAPPED_ATTRS = new Set([
  'htmlFor',
  'crossOrigin',
]);

/** M5.9: inline text write — if ($sK !== ($t = expr)) { $sK = $t; node.data = … } */
function textSetter(
  scope: EmitScope,
  key: string,
  varName: string,
  expr: t.Expression,
): () => t.Statement {
  return () =>
    slotGuard(scope, key, t.cloneNode(expr), (tmp) =>
      t.expressionStatement(
        t.assignmentExpression(
          '=',
          t.memberExpression(t.identifier(varName), t.identifier('data')),
          textValue(tmp),
        ),
      ),
    );
}

function emitText(ctx: Ctx, scope: EmitScope, expr: t.Expression): string {
  const varName = generatedIdentifier(ctx, `text${scope.textCounter++}`).name;
  if (t.isStringLiteral(expr)) {
    // static text: no slot, content baked into the node
    scope.creation.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.identifier(varName),
          t.callExpression(
            t.memberExpression(t.identifier('document'), t.identifier('createTextNode')),
            [t.stringLiteral(expr.value)],
          ),
        ),
      ]),
    );
    return varName;
  }
  const key = freshSlot(ctx, scope);
  scope.creation.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier(varName),
        t.callExpression(
          t.memberExpression(t.identifier('document'), t.identifier('createTextNode')),
          [t.stringLiteral('')],
        ),
      ),
    ]),
  );
  const setter = textSetter(scope, key, varName, expr);
  scope.creation.push(setter()); // R4: creation seeds through the same guarded setter
  scope.updaters.push(setter);
  return varName;
}

function expressionReadsBinding(node: t.Node, name: string): boolean {
  let found = false;
  t.traverseFast(node, (child) => {
    if (t.isIdentifier(child, { name })) found = true;
  });
  return found;
}

export function emitNode(
  ctx: Ctx,
  scope: EmitScope,
  node: JsxNode,
  compName: string,
  compPath: NodePath<t.FunctionDeclaration>,
  nestedIn: 'row' | 'cond' | null = null,
  rowCtx?: RowCtx,
  eventOriginId?: t.Expression,
  inSvg = false,
  ownerId: t.Expression = componentId(ctx, compName),
): string {
  return t.isJSXFragment(node)
    ? emitFragment(
        ctx,
        scope,
        node,
        compName,
        compPath,
        nestedIn,
        rowCtx,
        eventOriginId,
        inSvg,
        ownerId,
      )
    : emitElement(
        ctx,
        scope,
        node,
        compName,
        compPath,
        nestedIn,
        rowCtx,
        eventOriginId,
        inSvg,
        ownerId,
      );
}

function emitFragment(
  ctx: Ctx,
  scope: EmitScope,
  fragment: t.JSXFragment,
  compName: string,
  compPath: NodePath<t.FunctionDeclaration>,
  nestedIn: 'row' | 'cond' | null,
  rowCtx?: RowCtx,
  eventOriginId?: t.Expression,
  inSvg = false,
  ownerId: t.Expression = componentId(ctx, compName),
): string {
  const operations = collectDirectChildren(fragment.children, {
    emitText: (expression) => emitText(ctx, scope, expression),
    emitNode: (node) =>
      emitNode(
        ctx,
        scope,
        node,
        compName,
        compPath,
        nestedIn,
        rowCtx,
        eventOriginId,
        inSvg,
        ownerId,
      ),
    isForwarded: (expression) =>
      isChildrenReference(ctx, compName, expression),
    fail: (message) => {
      throw compPath.buildCodeFrameError(message);
    },
  });
  const variable = freshNodeName(ctx, scope, 'fragment');
  scope.creation.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier(variable),
        t.callExpression(
          t.memberExpression(
            t.identifier('document'),
            t.identifier('createDocumentFragment'),
          ),
          [],
        ),
      ),
    ]),
  );
  emitDirectChildOperations(
    ctx,
    scope,
    operations,
    variable,
    compName,
    compPath,
    nestedIn,
    inSvg,
    ownerId,
  );
  return variable;
}

function emitDirectChildOperations(
  ctx: Ctx,
  scope: EmitScope,
  operations: DirectChildOperation[],
  parentVar: string,
  compName: string,
  compPath: NodePath<t.FunctionDeclaration>,
  nestedIn: 'row' | 'cond' | null = null,
  inSvg = false,
  ownerId: t.Expression = componentId(ctx, compName),
): void {
  for (const operation of operations) {
    if (operation.type === 'node') {
      scope.creation.push(
        t.expressionStatement(
          t.callExpression(
            t.memberExpression(
              t.identifier(parentVar),
              t.identifier('appendChild'),
            ),
            [t.identifier(operation.variable)],
          ),
        ),
      );
    } else if (operation.type === 'slot') {
      scope.creation.push(
        t.ifStatement(
          t.binaryExpression(
            '!=',
            t.cloneNode(operation.expression),
            t.nullLiteral(),
          ),
          t.expressionStatement(
            t.callExpression(t.cloneNode(operation.expression), [
              t.identifier(parentVar),
            ]),
          ),
        ),
      );
    } else if (operation.type === 'list') {
      emitRegion(
        ctx,
        scope,
        operation.expression,
        parentVar,
        compName,
        compPath,
        inSvg,
        ownerId,
      );
    } else {
      emitCondRegion(
        ctx,
        scope,
        operation.expression,
        parentVar,
        compName,
        compPath,
        inSvg,
        ownerId,
        nestedIn !== null,
      );
    }
  }
}

function buildAuthoredChildrenSlot(
  ctx: Ctx,
  ownerScope: EmitScope,
  children: readonly JsxChild[],
  compName: string,
  compPath: NodePath<t.FunctionDeclaration>,
  nestedIn: 'row' | 'cond' | null,
  rowCtx: RowCtx | undefined,
  eventOriginId: t.Expression | undefined,
  inSvg: boolean,
  ownerId: t.Expression,
): t.Identifier {
  return buildChildrenSlot(ctx, ownerScope, (childScope, parentNode) => {
    emitChildrenIntoParent(
      childScope,
      children,
      parentNode.name,
      {
        emitText: (expression) => emitText(ctx, childScope, expression),
        emitNode: (node) =>
          emitNode(
            ctx,
            childScope,
            node,
            compName,
            compPath,
            nestedIn,
            rowCtx,
            eventOriginId,
            inSvg,
            ownerId,
          ),
        emitList: (call, parentVar) =>
          emitRegion(
            ctx,
            childScope,
            call,
            parentVar,
            compName,
            compPath,
            inSvg,
            ownerId,
          ),
        emitCondition: (expression, parentVar) =>
          emitCondRegion(
            ctx,
            childScope,
            expression,
            parentVar,
            compName,
            compPath,
            inSvg,
            ownerId,
            nestedIn !== null,
          ),
        isForwarded: (expression) =>
          isChildrenReference(ctx, compName, expression),
        fail: (message) => {
          throw compPath.buildCodeFrameError(message);
        },
      },
    );
  });
}

function emitElement(
  ctx: Ctx,
  scope: EmitScope,
  el: t.JSXElement,
  compName: string,
  compPath: NodePath<t.FunctionDeclaration>,
  nestedIn: 'row' | 'cond' | null = null,
  rowCtx?: RowCtx,
  eventOriginId?: t.Expression,
  inSvg = false,
  ownerId: t.Expression = componentId(ctx, compName),
): string {
  const open = el.openingElement;
  const tag = (open.name as t.JSXIdentifier).name;

  // -- nested component: call its factory, append what it returns --------
  if (/^[A-Z]/.test(tag)) {
    // repeated children of the same type need distinct variables AND
    // distinct entity ids: 'App/Tag', 'App/Tag[1]', …
    const seen = scope.childCounts.get(tag) ?? 0;
    scope.childCounts.set(tag, seen + 1);
    const base = tag.charAt(0).toLowerCase() + tag.slice(1);
    const candidate = seen === 0 ? base : `${base}${seen}`;
    // A generated child result must never shadow a user/module binding. The
    // old `const count = Count(..., [count])` both hit the TDZ in its own
    // initializer and changed every later `count` reference in the factory.
    const varName = generatedIdentifier(ctx, candidate).name;
    const idSuffix = seen === 0 ? `/${tag}` : `/${tag}[${seen}]`;
    const propEntries: Array<{ name: string; value: t.Expression }> = [];
    const componentHasSpread = open.attributes.some((attribute) =>
      t.isJSXSpreadAttribute(attribute),
    );
    let orderedPropObject: t.ObjectExpression | null = null;
    let needsPush = false;
    if (componentHasSpread) {
      const ordered = buildOrderedAttributes(open.attributes, {
        fail: (message) => {
          throw compPath.buildCodeFrameError(message);
        },
      });
      orderedPropObject = ordered.expression;
      needsPush = ordered.sources.some((source) =>
        exprReadsState(ctx, source, compName) ||
        (rowCtx !== undefined &&
          expressionReadsBinding(source, rowCtx.itemParam)),
      );
    } else {
    for (const attr of open.attributes) {
      const a = attr as t.JSXAttribute;
      const v =
        a.value == null ? t.booleanLiteral(true) : attrExpr(a.value);
      if (v == null) {
        throw compPath.buildCodeFrameError(
          `memo-dom: prop '${jsxAttributeName(
            a.name,
          )}' on <${tag}> must be an expression`,
        );
      }
      // R12: instance-state reads also need re-push (parent re-renders on
      // instance writes → this updater re-syncs the child's props box)
      if (
        exprReadsState(ctx, v, compName) ||
        (rowCtx !== undefined &&
          expressionReadsBinding(v, rowCtx.itemParam))
      ) {
        needsPush = true;
      }
      // Instrument function-valued props so writes to parent instance state
      // inside them produce the correct markDirty call. This is the same
      // treatment that callbacks passed to setInterval/addEventListener get
      // via transformComponentLifecycle — component prop functions that close
      // over parent state need identical treatment (R12 local invalidation).
      // Guard: skip JSX-bearing functions — those are component definitions,
      // not callbacks. The analyzedFunctions WeakSet in instrumentComponentCallback
      // prevents double-instrumentation if the same function was already seen
      // through a native onClick attribute on the same component.
      if (t.isArrowFunctionExpression(v) || t.isFunctionExpression(v)) {
        if (!nodeHasJsx(v.body)) {
          instrumentComponentCallback(ctx, compPath, v, compName, rowCtx);
        }
      } else if (t.isIdentifier(v)) {
        const localFn = resolveLocalHelper(compPath, v.name);
        if (localFn !== null && !nodeHasJsx(localFn.body)) {
          instrumentComponentCallback(ctx, compPath, localFn, compName, rowCtx);
        }
      }
      propEntries.push({
        name: jsxAttributeName(a.name),
        value: t.cloneNode(v),
      });
    }
    }
    if (hasComponentChildren(el.children)) {
      if (
        open.attributes.some(
          (attribute) =>
            t.isJSXAttribute(attribute) &&
            jsxAttributeName(attribute.name) === 'children',
        )
      ) {
        throw compPath.buildCodeFrameError(
          `memo-dom: <${tag}> cannot use both a children prop and nested JSX children`,
        );
      }
      const childrenSlot = buildAuthoredChildrenSlot(
        ctx,
        scope,
        el.children,
        compName,
        compPath,
        nestedIn,
        rowCtx,
        eventOriginId,
        inSvg,
        ownerId,
      );
      if (orderedPropObject !== null) {
        orderedPropObject.properties.push(
          t.objectProperty(
            t.identifier('children'),
            t.cloneNode(childrenSlot),
          ),
        );
      } else {
        propEntries.push({
          name: 'children',
          value: t.cloneNode(childrenSlot),
        });
      }
    }
    // Props are matched BY NAME against the callee's declared params — JSX
    // attribute order is irrelevant (positional matching silently misaligned
    // props when attribute order and declaration order disagreed).
    let props: t.Expression[];
    if (orderedPropObject !== null) {
      const propObject = generatedIdentifier(ctx, `${base}Props`);
      scope.creation.push(
        t.variableDeclaration('const', [
          t.variableDeclarator(
            t.cloneNode(propObject),
            t.cloneNode(orderedPropObject),
          ),
        ]),
      );
      props = callPropsFromObject(ctx, tag, propObject);
    } else {
      props = orderCallProps(ctx, tag, propEntries);
    }
    const childId = t.binaryExpression(
      '+',
      t.cloneNode(ownerId),
      t.stringLiteral(idSuffix),
    );
    scope.creation.push(
      t.variableDeclaration('const', [
        t.variableDeclarator(
          t.identifier(varName),
          t.callExpression(t.identifier(tag), [
            childId,
            t.cloneNode(ownerId),
            ...(props.length > 0 ? [t.arrayExpression(props)] : []),
          ]),
        ),
      ]),
    );
    scope.disposableEntities.push(t.cloneNode(childId));
    // R10: re-push state-reading props inside the parent's update — the box
    // flows down through setProps (shallow-compare → no-op when unchanged)
    if (needsPush) {
      scope.updaters.push(() =>
        orderedPropObject === null
          ? t.expressionStatement(
              t.callExpression(md(ctx, 'setProps'), [
                t.binaryExpression(
                  '+',
                  t.cloneNode(ownerId),
                  t.stringLiteral(idSuffix),
                ),
                t.arrayExpression(props.map((p) => t.cloneNode(p))),
              ]),
            )
          : buildSpreadComponentPropUpdate(
              ctx,
              tag,
              ownerId,
              idSuffix,
              orderedPropObject,
            ),
      );
    }
    return varName;
  }

  const elementSvg = isSvgElement(tag, inSvg);
  const childSvg = elementSvg && tag !== 'foreignObject';
  const innerHtmlAttribute = open.attributes.find(
    (attribute) =>
      t.isJSXAttribute(attribute) &&
      jsxAttributeName(attribute.name) === 'innerHTML',
  );
  if (innerHtmlAttribute !== undefined) {
    if (elementSvg) {
      throw compPath.buildCodeFrameError(
        'memo-dom: innerHTML is only supported on HTML elements',
      );
    }
    const hasMeaningfulChildren = el.children.some(
      (child) => !t.isJSXText(child) || child.value.trim() !== '',
    );
    if (hasMeaningfulChildren) {
      throw compPath.buildCodeFrameError(
        'memo-dom: an element using innerHTML cannot also have JSX children',
      );
    }
  }

  // Children emit post-order; insertion operations retain authored order.
  const childOperations = collectDirectChildren(el.children, {
    emitText: (expression) => emitText(ctx, scope, expression),
    emitNode: (node) =>
      emitNode(
        ctx,
        scope,
        node,
        compName,
        compPath,
        nestedIn,
        rowCtx,
        eventOriginId,
        childSvg,
        ownerId,
      ),
    isForwarded: (expression) =>
      isChildrenReference(ctx, compName, expression),
    fail: (message) => {
      throw compPath.buildCodeFrameError(message);
    },
  });
  if (
    nestedIn === 'row' &&
    childOperations.some((operation) => operation.type === 'list')
  ) {
    throw compPath.buildCodeFrameError(
      'memo-dom: nested lists inside list rows are not supported yet',
    );
  }
  const varName = freshNodeName(ctx, scope, tag);
  scope.creation.push(
    t.variableDeclaration('const', [
      t.variableDeclarator(
        t.identifier(varName),
        createElementExpression(tag, elementSvg),
      ),
    ]),
  );

  // -- attributes ---------------------------------------------------------
  const hasSpread = open.attributes.some((attribute) =>
    t.isJSXSpreadAttribute(attribute),
  );
  if (hasSpread) {
    const ordered = buildOrderedAttributes(open.attributes, {
      eventValue: (name, value) => {
        const handler = buildHandler(
          ctx,
          compPath,
          value,
          name,
          compName,
          rowCtx,
          eventOriginId,
        );
        const binding = generatedIdentifier(ctx, `${name}Handler`);
        scope.creation.push(
          t.variableDeclaration('const', [
            t.variableDeclarator(t.cloneNode(binding), handler),
          ]),
        );
        return binding;
      },
      fail: (message) => {
        throw compPath.buildCodeFrameError(message);
      },
    });
    const patch = (): t.Statement =>
      t.expressionStatement(
        t.callExpression(md(ctx, 'patchDomProps'), [
          t.identifier(varName),
          t.cloneNode(ordered.expression),
          t.stringLiteral(ctx.rootId),
          t.arrayExpression(
            ordered.safeEventKeys.map((name) => t.stringLiteral(name)),
          ),
        ]),
      );
    scope.creation.push(patch());
    scope.updaters.push(patch);
  } else {
    for (const attr of open.attributes) {
    const a = attr as t.JSXAttribute;
    const attrName = jsxAttributeName(a.name);

    // backstop: row-root keys are stripped before emission, so any key
    // reaching here is misuse (analysis catches static cases with a nicer
    // message; row/branch subtrees skip that pass)
    if (attrName === 'key') {
      throw compPath.buildCodeFrameError(
        'memo-dom: key={...} is only meaningful on list rows: items.map(item => <Row key={item.id} />)',
      );
    }

    if (/^on[A-Z]/.test(attrName)) {
      const v = attrExpr(a.value);
      if (v == null) {
        throw compPath.buildCodeFrameError(
          `memo-dom: ${attrName} needs a handler expression (L1)`,
        );
      }
      const handler = buildHandler(
        ctx,
        compPath,
        v,
        attrName,
        compName,
        rowCtx,
        eventOriginId,
      );
      scope.creation.push(
        t.expressionStatement(
          t.assignmentExpression(
            '=',
            t.memberExpression(t.identifier(varName), t.identifier(attrName.toLowerCase())),
            handler,
          ),
        ),
      );
      continue;
    }

    if (t.isStringLiteral(a.value)) {
      if (attrName === 'class' || attrName === 'className') {
        scope.creation.push(
          t.expressionStatement(
            t.callExpression(md(ctx, 'setClassValue'), [
              t.identifier(varName),
              t.stringLiteral(a.value.value),
            ]),
          ),
        );
      } else if (attrName === 'style') {
        scope.creation.push(
          t.expressionStatement(
            t.callExpression(md(ctx, 'setStyleValue'), [
              t.identifier(varName),
              t.stringLiteral(a.value.value),
            ]),
          ),
        );
      } else if (
        attrName === 'innerHTML' ||
        DOM_MAPPED_ATTRS.has(attrName) ||
        elementSvg
      ) {
        scope.creation.push(
          t.expressionStatement(
            t.callExpression(md(ctx, 'setDomValue'), [
              t.identifier(varName),
              t.stringLiteral(attrName),
              t.stringLiteral(a.value.value),
            ]),
          ),
        );
      } else {
        scope.creation.push(
          t.expressionStatement(
            t.callExpression(
              t.memberExpression(t.identifier(varName), t.identifier('setAttribute')),
              [t.stringLiteral(attrName), t.stringLiteral(a.value.value)],
            ),
          ),
        );
      }
      continue;
    }

    const v =
      a.value == null ? t.booleanLiteral(true) : attrExpr(a.value);
    if (v == null || t.isStringLiteral(v)) {
      throw compPath.buildCodeFrameError(
        `memo-dom: attribute '${attrName}' needs a string or an expression (L1)`,
      );
    }
    const expr = t.cloneNode(v);
    if (attrName === 'style') {
      const setStyle = (): t.Statement =>
        t.expressionStatement(
          t.callExpression(md(ctx, 'setStyleValue'), [
            t.identifier(varName),
            t.cloneNode(expr),
          ]),
        );
      scope.creation.push(setStyle());
      scope.updaters.push(setStyle);
      continue;
    }
    const key = freshSlot(ctx, scope);
    // M5.8: IDL-property attributes (checked, value, disabled, …) write the
    // DOM property, not the attribute — faster (no attribute-tree walk) and
    // semantically correct for state that lives on the element object.
    const propName =
      !elementSvg && DOM_PROP_ATTRS.has(attrName) ? attrName : null;
    // M5.9: inline guarded writes (see slotGuard) — no MD.setX call overhead
    const makeCall = (): t.Statement =>
      attrName === 'class' || attrName === 'className'
        ? slotGuard(
            scope,
            key,
            t.callExpression(md(ctx, 'classValue'), [t.cloneNode(expr)]),
            (tmp) =>
            t.expressionStatement(
              t.callExpression(md(ctx, 'setClassValue'), [
                t.identifier(varName),
                tmp,
              ]),
            ),
          )
        : propName !== null ||
            DOM_MAPPED_ATTRS.has(attrName) ||
            elementSvg
          ? slotGuard(scope, key, t.cloneNode(expr), (tmp) =>
              t.expressionStatement(
                t.callExpression(md(ctx, 'setDomValue'), [
                  t.identifier(varName),
                  t.stringLiteral(attrName),
                  tmp,
                ]),
              ),
            )
          : slotGuard(scope, key, t.cloneNode(expr), (tmp) =>
              t.expressionStatement(
                t.conditionalExpression(
                  t.logicalExpression(
                    '||',
                    t.binaryExpression('==', t.cloneNode(tmp), t.nullLiteral()),
                    t.binaryExpression('===', t.cloneNode(tmp), t.booleanLiteral(false)),
                  ),
                  t.callExpression(
                    t.memberExpression(t.identifier(varName), t.identifier('removeAttribute')),
                    [t.stringLiteral(attrName)],
                  ),
                  t.callExpression(
                    t.memberExpression(t.identifier(varName), t.identifier('setAttribute')),
                    [
                      t.stringLiteral(attrName),
                      t.conditionalExpression(
                        t.binaryExpression('===', t.cloneNode(tmp), t.booleanLiteral(true)),
                        t.stringLiteral(''),
                        t.callExpression(t.identifier('String'), [t.cloneNode(tmp)]),
                      ),
                    ],
                  ),
                ),
              ),
            );
    scope.creation.push(makeCall());
    scope.updaters.push(makeCall);
  }
  }

  emitDirectChildOperations(
    ctx,
    scope,
    childOperations,
    varName,
    compName,
    compPath,
    nestedIn,
    childSvg,
    ownerId,
  );

  return varName;
}

// ---------------------------------------------------------------------
// R7: list regions
// ---------------------------------------------------------------------

function emitRegion(
  ctx: Ctx,
  scope: EmitScope,
  call: t.CallExpression,
  parentElVar: string,
  compName: string,
  compPath: NodePath<t.FunctionDeclaration>,
  inSvg = false,
  ownerId: t.Expression = componentId(ctx, compName),
): void {
  emitListRegion(
    ctx,
    scope,
    call,
    parentElVar,
    compName,
    compPath,
    emitNode,
    buildAuthoredChildrenSlot,
    inSvg,
    ownerId,
  );
}

// ---------------------------------------------------------------------
// R8: conditional regions
// ---------------------------------------------------------------------

/**
 * `{cond ? <A/> : <B/>}` → an anchored conditional region, registered as its
 * OWN entity ('<ownerId>/when<n>') so the table routes the region's vars to
 * it. The render closure is `() => whenN.update()` — a closure over the
 * region variable declared right after (same pattern as the component's own
 * update closure; render only runs post-mount).
 */
function emitCondRegion(
  ctx: Ctx,
  scope: EmitScope,
  expr: t.ConditionalExpression | t.LogicalExpression,
  parentElVar: string,
  compName: string,
  compPath: NodePath<t.FunctionDeclaration>,
  inSvg = false,
  ownerId: t.Expression = componentId(ctx, compName),
  forwardFromOwner = false,
): void {
  emitConditionalRegion(
    ctx,
    scope,
    expr,
    parentElVar,
    compName,
    compPath,
    emitNode,
    inSvg,
    ownerId,
    forwardFromOwner,
  );
}

/**
 * A branch is a small factory: own slot cache, own guarded update closure,
 * NO register (branches are not entities — a swap just removes their nodes).
 * Emitted into a fresh EmitScope so variables and slots never collide.
 */
export function buildBranchCreate(
  ctx: Ctx,
  jsx: JsxNode,
  compName: string,
  compPath: NodePath<t.FunctionDeclaration>,
  regionId: t.Expression,
  inSvg = false,
  ownerId: t.Expression = regionId,
  allowConditions = false,
  usedConds?: { count: number },
): t.ArrowFunctionExpression {
  return buildConditionalBranchCreate(
    ctx,
    jsx,
    compName,
    compPath,
    regionId,
    emitNode,
    inSvg,
    ownerId,
    allowConditions,
    usedConds,
  );
}
