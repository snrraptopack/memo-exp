/**
 * React source is an input dialect. A validated plan translates its supported
 * operations into ordinary MMD component syntax before shared analysis runs.
 * No React hook dispatcher or element object is emitted.
 */
import type * as t from '../ast/compiler-types';
import * as ast from '../ast/factory';
import { analyzeScope, cloneNode, walkAst, type BaseNode } from '../ast';
import { removeNode, replaceNode } from '../ast/mutate';
import { nodeHasJsx, type Ctx, type ProgramPath } from '../context';

type HookName = 'useState' | 'useReducer' | 'useRef' | 'useMemo' | 'useCallback' |
  'useEffect' | 'useSyncExternalStore' | 'useLayoutEffect' | 'useInsertionEffect' |
  'useDeferredValue' | 'useTransition' | 'useDebugValue' | 'useImperativeHandle' |
  'useId' | 'use' | 'useActionState' | 'startTransition';
function isReactSpecifier(source: string): boolean {
  return source === 'react' || source.startsWith('react/') ||
    source === 'react-dom' || source.startsWith('react-dom/');
}
type Operation =
  | { kind: 'state' | 'reducer'; statement: t.VariableDeclaration; call: t.CallExpression;
      state: string | null; setter: string | null; owner: t.FunctionDeclaration }
  | { kind: 'external-store'; statement: t.VariableDeclaration;
      owner: t.FunctionDeclaration; state: string; subscribe: t.Expression;
      getSnapshot: t.Expression }
  | { kind: 'ref'; declarator: t.VariableDeclarator; call: t.CallExpression }
  | { kind: 'memo'; declarator: t.VariableDeclarator; value: t.Expression }
  | { kind: 'callback'; declarator: t.VariableDeclarator;
      value: t.Expression }
  | { kind: 'effect'; call: t.CallExpression; callback: t.Expression;
      statement: t.ExpressionStatement; owner: t.FunctionDeclaration; phase: number }
  | { kind: 'debug-value'; statement: t.ExpressionStatement }
  | { kind: 'deferred'; declarator: t.VariableDeclarator; value: t.Expression }
  | { kind: 'transition'; statement: t.VariableDeclaration; pending: string | null;
      start: string | null; owner: t.FunctionDeclaration }
  | { kind: 'imperative-handle'; statement: t.ExpressionStatement;
      owner: t.FunctionDeclaration; ref: t.Expression; create: t.Expression }
  | { kind: 'id'; statement: t.VariableDeclaration; name: string;
      owner: t.FunctionDeclaration }
  | { kind: 'read'; declarator: t.VariableDeclarator; promise: t.Expression }
  | { kind: 'action-state'; statement: t.VariableDeclaration; owner: t.FunctionDeclaration;
      action: t.Expression; initial: t.Expression;
      state: string | null; dispatch: string | null; pending: string | null }
  | { kind: 'start-transition'; node: BaseNode; argument: t.Expression | null };

/** A JSX transform staged during validation and applied after the plan passes. */
type JsxOperation =
  | { kind: 'group'; element: t.JSXElement }
  | { kind: 'unwrap'; element: t.JSXElement }
  | { kind: 'form-action'; opening: t.JSXOpeningElement;
      attribute: t.JSXAttribute; expression: t.Expression };

/**
 * Named React surfaces that are rejected with a pointed diagnosis rather than
 * the generic failure, so library source reports which boundary it hit.
 */
const DIAGNOSED: Record<string, string> = {
  createContext: `requires an ancestry-scoped context channel that MMD does not provide; lift state or pass props (see assimilation/11-usecontext)`,
  useContext: `requires an ancestry-scoped context channel that MMD does not provide; lift state or pass props (see assimilation/11-usecontext)`,
  useFormStatus: `reads the enclosing form through an implicit context that MMD does not provide; read 'pending' from a $forms source and pass it as a prop (see assimilation/20-forms)`,
  useOptimistic: `requires action-scoped optimistic state; use optimistic({ action, apply, reconcile }) from '@memoized-dom/utils' (see assimilation/20-forms)`,
  lazy: `is component-level code splitting; MMD code-splits at route boundaries (the route attribute)`,
  createPortal: `mounts into a foreign container; MMD JSX owns only its own subtree and has no portal primitive`,
  createRoot: `is an entry API owned by the MMD mount pipeline; remove the react-dom bootstrap from component modules`,
  hydrateRoot: `is an entry API owned by the MMD mount pipeline; remove the react-dom bootstrap from component modules`,
  render: `is an entry API owned by the MMD mount pipeline; remove the react-dom bootstrap from component modules`,
  unmountComponentAtNode: `is an entry API owned by the MMD mount pipeline`,
  findDOMNode: `has no element-object host lookup; pass an MMD ref sink`,
  flushSync: `asks for a synchronous scheduler flush; MMD writes settle in one scheduler turn without flushing`,
  act: `is a test-environment shim over React's scheduler and has no MMD target`,
  StrictMode: `is a development double-invoke harness; MMD mounts once and has no simulated remount`,
  Profiler: `is React instrumentation; MMD has no profiler surface`,
  Component: `is a class component base; MMD components are functions`,
  PureComponent: `is a class component base; MMD components are functions`,
  createElement: `creates element objects; MMD JSX values are rendered, not values`,
  cloneElement: `mutates element objects; MMD children are opaque slots, not values`,
  isValidElement: `inspects element objects; MMD children are opaque slots, not values`,
  createFactory: `creates element objects; MMD JSX values are rendered, not values`,
};

interface ImportUse {
  readonly name: string;
  readonly source: string;
  readonly binding: ReturnType<typeof analyzeScope>['rootScope']['bindings'] extends Map<string, infer B> ? B : never;
  readonly namespace: boolean;
}

type Binding = ImportUse['binding'];

interface ReactUseScan {
  readonly uses: ImportUse[];
  readonly analysis: ReturnType<typeof analyzeScope>;
}

function reactImportDeclarations(program: t.Program): t.ImportDeclaration[] {
  return program.body.filter((statement): statement is t.ImportDeclaration =>
    ast.isImportDeclaration(statement) &&
    ast.isStringLiteral(statement.source) &&
    isReactSpecifier(String(statement.source.value)));
}

function collectReactUses(
  program: t.Program,
  imports: readonly t.ImportDeclaration[],
): ReactUseScan {
  const analysis = analyzeScope(program as BaseNode);
  const uses: ImportUse[] = [];
  for (const declaration of imports) {
    for (const specifier of declaration.specifiers) {
      const binding = analysis.rootScope.bindings.get(specifier.local.name);
      if (binding === undefined) continue;
      const namespace = specifier.type !== 'ImportSpecifier';
      const name = namespace
        ? '*'
        : ast.isIdentifier(specifier.imported) ? specifier.imported.name
        : ast.isStringLiteral(specifier.imported) ? String(specifier.imported.value) : '';
      uses.push({ name, source: String(declaration.source.value), binding, namespace });
    }
  }
  return { uses, analysis };
}

function copy<T>(node: T): T {
  return cloneNode(node as BaseNode, true) as T;
}

/**
 * True when `expression` is an identifier bound to a `const x = <imported>()`
 * call where `<imported>` resolves to the named React import — used to catch
 * `use(context)` double-duty without treating arbitrary promise consts as
 * context objects.
 */
function boundToReactCall(
  analysis: ReactUseScan['analysis'],
  uses: readonly ImportUse[],
  expression: t.Expression,
  imported: string,
): boolean {
  if (!ast.isIdentifier(expression)) return false;
  const binding = analysis.nodeToScope.get(expression as BaseNode)
    ?.getBinding(expression.name);
  const node = binding?.declarationNode;
  if (node === undefined || node.type !== 'VariableDeclarator') return false;
  const init = (node as t.VariableDeclarator).init;
  if (init === null || !ast.isCallExpression(init)) return false;
  const callee = init.callee;
  if (ast.isIdentifier(callee)) {
    const calleeBinding = analysis.nodeToScope.get(callee as BaseNode)
      ?.getBinding(callee.name);
    return uses.some((use) =>
      !use.namespace && use.name === imported && use.binding === calleeBinding);
  }
  if (ast.isMemberExpression(callee) && !callee.computed &&
      ast.isIdentifier(callee.object) && ast.isIdentifier(callee.property) &&
      callee.property.name === imported) {
    const nsBinding = analysis.nodeToScope.get(callee.object as BaseNode)
      ?.getBinding(callee.object.name);
    return uses.some((use) => use.namespace && use.binding === nsBinding);
  }
  return false;
}

function enclosingFunction(
  analysis: ReturnType<typeof analyzeScope>,
  node: BaseNode,
): t.FunctionDeclaration | null {
  let parent = analysis.parentByNode.get(node) ?? null;
  while (parent !== null) {
    if (ast.isFunction(parent)) {
      return ast.isFunctionDeclaration(parent) ? parent : null;
    }
    parent = analysis.parentByNode.get(parent) ?? null;
  }
  return null;
}

function componentOwner(
  analysis: ReturnType<typeof analyzeScope>,
  call: t.CallExpression,
): t.FunctionDeclaration | null {
  const owner = enclosingFunction(analysis, call as BaseNode);
  if (owner?.id == null || !/^[A-Z]/.test(owner.id.name) || !nodeHasJsx(owner.body)) {
    return null;
  }
  const parent = analysis.parentByNode.get(owner as BaseNode);
  if (parent?.type === 'Program') return owner;
  if (parent?.type === 'ExportNamedDeclaration' || parent?.type === 'ExportDefaultDeclaration') {
    return analysis.parentByNode.get(parent)?.type === 'Program' ? owner : null;
  }
  return null;
}

function returnedExpression(value: t.Expression): t.Expression | null {
  if (!ast.isArrowFunctionExpression(value) && !ast.isFunctionExpression(value)) return null;
  if (value.async || value.generator || value.params.length !== 0) return null;
  if (!ast.isBlockStatement(value.body)) return value.body;
  if (value.body.body.length !== 1 || !ast.isReturnStatement(value.body.body[0])) return null;
  return value.body.body[0].argument;
}

function argument(call: t.CallExpression, index: number): t.Expression | null {
  const value = call.arguments[index];
  return value !== undefined && ast.isExpression(value) ? value : null;
}

function hookCall(
  use: ImportUse,
  reference: BaseNode,
  analysis: ReturnType<typeof analyzeScope>,
): t.CallExpression | null {
  let callee: BaseNode = reference;
  if (use.namespace) {
    const member = analysis.parentByNode.get(reference);
    if (!ast.isMemberExpression(member) || member.object !== reference || member.computed ||
        member.optional || !ast.isIdentifier(member.property)) return null;
    callee = member;
  }
  const parent = analysis.parentByNode.get(callee);
  return ast.isCallExpression(parent) && parent.callee === callee && !parent.optional
    ? parent : null;
}

function foldRefParameter(
  fn: t.ArrowFunctionExpression | t.FunctionExpression,
): boolean {
  const refParam = fn.params[1];
  if (refParam === undefined) return true;
  if (!ast.isIdentifier(refParam)) return false;
  const props = fn.params[0];
  if (props === undefined) return false;
  const target = ast.isAssignmentPattern(props) ? props.left : props;
  if (ast.isObjectPattern(target)) {
    const hasRef = target.properties.some((property) =>
      !ast.isRestElement(property) && !property.computed &&
      ast.isIdentifier(property.key) && property.key.name === 'ref');
    if (hasRef) return false;
    const slot = ast.objectProperty(
      ast.identifier('ref'),
      ast.identifier(refParam.name),
    );
    const rest = target.properties.findIndex((property) => ast.isRestElement(property));
    if (rest === -1) target.properties.push(slot);
    else target.properties.splice(rest, 0, slot);
  } else if (ast.isIdentifier(target)) {
    const bind = ast.variableDeclaration('const', [ast.variableDeclarator(
      ast.identifier(refParam.name),
      ast.memberExpression(ast.identifier(target.name), ast.identifier('ref')),
    )]);
    if (ast.isBlockStatement(fn.body)) fn.body.body.unshift(bind);
    else {
      fn.body = ast.blockStatement([
        bind,
        ast.returnStatement(fn.body as t.Expression),
      ]);
    }
  } else return false;
  fn.params = fn.params.slice(0, 1);
  return true;
}

/**
 * React component wrappers are declaration-level syntax: `memo()` is erased
 * and `forwardRef()`'s second parameter folds into the MMD `ref` prop binding,
 * matching authored MMD (`function Input({ label, ref: forwarded })`).
 * Runs before component declaration normalization so wrapped components enter
 * the canonical function-declaration path like any authored component.
 */
export function unwrapReactComponentWrappers(programPath: ProgramPath): void {
  const program = programPath.node;
  const imports = reactImportDeclarations(program);
  if (imports.length === 0) return;
  const { uses, analysis } = collectReactUses(program, imports);

  const named = new Map<Binding, 'memo' | 'forwardRef'>();
  const namespaces = new Set<Binding>();
  for (const use of uses) {
    if (use.namespace) namespaces.add(use.binding);
    else if (use.name === 'memo' || use.name === 'forwardRef') {
      named.set(use.binding, use.name);
    }
  }
  if (named.size === 0 && namespaces.size === 0) return;

  const wrapperName = (callee: t.Expression): 'memo' | 'forwardRef' | null => {
    if (ast.isIdentifier(callee)) {
      const binding = analysis.nodeToScope.get(callee as BaseNode)?.getBinding(callee.name);
      return binding === undefined ? null : named.get(binding) ?? null;
    }
    if (ast.isMemberExpression(callee) && !callee.computed && !callee.optional &&
        ast.isIdentifier(callee.object) && ast.isIdentifier(callee.property)) {
      const binding = analysis.nodeToScope.get(callee.object as BaseNode)
        ?.getBinding(callee.object.name);
      if (binding !== undefined && namespaces.has(binding) &&
          (callee.property.name === 'memo' || callee.property.name === 'forwardRef')) {
        return callee.property.name;
      }
    }
    return null;
  };

  const peel = (init: t.Expression): t.Expression | null => {
    const chain: { name: 'memo' | 'forwardRef'; inner: t.Expression }[] = [];
    let expr = init;
    while (ast.isCallExpression(expr) && !expr.optional &&
           expr.arguments.length === 1 && ast.isExpression(expr.arguments[0]!)) {
      const name = wrapperName(expr.callee);
      if (name === null) break;
      chain.push({ name, inner: expr.arguments[0] as t.Expression });
      expr = expr.arguments[0] as t.Expression;
    }
    if (chain.length === 0 ||
        (!ast.isArrowFunctionExpression(expr) && !ast.isFunctionExpression(expr))) {
      return null;
    }
    const fn = expr;
    for (const entry of chain) {
      // forwardRef owns the render function itself: it must be innermost.
      if (entry.name === 'forwardRef' && (entry.inner !== fn || !foldRefParameter(fn))) {
        return null;
      }
    }
    return fn;
  };

  for (const statement of program.body) {
    const declaration = ast.isVariableDeclaration(statement) ? statement
      : ast.isExportNamedDeclaration(statement) && statement.declaration !== null &&
        ast.isVariableDeclaration(statement.declaration) ? statement.declaration : null;
    if (declaration === null) continue;
    for (const declarator of declaration.declarations) {
      if (!ast.isIdentifier(declarator.id) || !/^[A-Z]/.test(declarator.id.name) ||
          declarator.init === null) continue;
      const unwrapped = peel(declarator.init);
      if (unwrapped !== null) declarator.init = unwrapped;
    }
  }
}

/** Called by both manifest analysis and final emission on their own AST clone. */
export function assimilateReactSource(ctx: Ctx, programPath: ProgramPath): void {
  const program = programPath.node;
  const imports = reactImportDeclarations(program);
  const exportsFromReact = program.body.filter((statement) =>
    ((ast.isExportNamedDeclaration(statement) && statement.source !== null) ||
      statement.type === 'ExportAllDeclaration') &&
    ast.isStringLiteral(statement.source) && isReactSpecifier(String(statement.source.value)));
  if (imports.length === 0 && exportsFromReact.length === 0) return;
  const { uses, analysis } = collectReactUses(program, imports);

  const operations: Operation[] = [];
  const accepted = new Set<HookName>([
    'useState', 'useReducer', 'useRef', 'useMemo', 'useCallback', 'useEffect',
    'useSyncExternalStore', 'useLayoutEffect', 'useInsertionEffect',
    'useDeferredValue', 'useTransition', 'useDebugValue', 'useImperativeHandle',
    'useId', 'use', 'useActionState',
  ]);
  const seenCalls = new Set<t.CallExpression>();
  function fail(message: string, node: BaseNode): never {
    throw programPath.buildCodeFrameError(`memo-dom: React assimilation ${message}`, node as t.Node);
  }

  if (exportsFromReact.length > 0) {
    fail(`cannot re-export a React runtime surface without a translation plan`, exportsFromReact[0]!);
  }
  for (const declaration of imports) {
    if (declaration.specifiers.length === 0 && declaration.importKind !== 'type') {
      fail(`cannot erase a side-effect import from '${declaration.source.value}'`, declaration);
    }
  }
  const importedByName = new Map(uses.map((use) => [use.binding.name, use]));
  const jsxOperations: JsxOperation[] = [];
  const consumedReferences = new Set<BaseNode>();
  const consumeNameReferences = (name: t.JSXOpeningElement['name']): void => {
    walkAst(name as BaseNode, { enter(part) {
      if (part.type === 'JSXIdentifier') consumedReferences.add(part);
    } });
  };
  const submitValueIsFunction = (expression: t.Expression): boolean => {
    if (ast.isArrowFunctionExpression(expression) || ast.isFunctionExpression(expression) ||
        ast.isMemberExpression(expression) || ast.isCallExpression(expression)) return true;
    if (!ast.isIdentifier(expression)) return false;
    const binding = analysis.nodeToScope.get(expression as BaseNode)?.getBinding(expression.name);
    if (binding === undefined) return true;
    const declaration = binding.declarationNode;
    if (ast.isVariableDeclarator(declaration)) {
      const init = declaration.init;
      return init !== null && (ast.isArrowFunctionExpression(init) ||
        ast.isFunctionExpression(init) || ast.isMemberExpression(init) || ast.isCallExpression(init));
    }
    return true;
  };
  walkAst(program as BaseNode, { enter(node) {
    if (node.type !== 'JSXOpeningElement') return;
    const opening = node as t.JSXOpeningElement;
    const element = analysis.parentByNode.get(node);
    const name = opening.name;
    let tag: t.JSXOpeningElement['name'] = name;
    let memberProperty: string | null = null;
    if (tag.type === 'JSXMemberExpression' && tag.object.type === 'JSXIdentifier') {
      memberProperty = ast.isJSXIdentifier(tag.property) ? tag.property.name : null;
      tag = tag.object;
    } else while (tag.type === 'JSXMemberExpression') tag = tag.object;
    if (tag.type === 'JSXIdentifier') {
      const use = importedByName.get(tag.name);
      if (use !== undefined && analysis.nodeToScope.get(node)?.getBinding(tag.name) === use.binding) {
        const reactName = memberProperty ?? (use.namespace ? null : use.name);
        if (reactName === 'Suspense' && ast.isJSXElement(element)) {
          for (const attribute of opening.attributes) {
            if (!ast.isJSXAttribute(attribute) || !ast.isJSXIdentifier(attribute.name) ||
                attribute.name.name !== 'fallback') {
              fail(`allows only 'fallback' and children on <Suspense>; other props have no MMD target`, attribute as BaseNode);
            }
          }
          jsxOperations.push({ kind: 'group', element: element as t.JSXElement });
          consumeNameReferences(name);
          return;
        }
        if ((reactName === 'Fragment' || reactName === 'StrictMode') && ast.isJSXElement(element)) {
          for (const attribute of opening.attributes) {
            const label = reactName === 'Fragment' && ast.isJSXAttribute(attribute) &&
              ast.isJSXIdentifier(attribute.name) && attribute.name.name === 'key'
              ? `'key' on <Fragment> — MMD rows key through list items, not fragments`
              : `prop on <${reactName}> — it is a transparent wrapper and carries no attributes`;
            fail(`has no MMD translation for ${label}`, attribute as BaseNode);
          }
          jsxOperations.push({ kind: 'unwrap', element: element as t.JSXElement });
          consumeNameReferences(name);
          return;
        }
        fail(`has no MMD translation for JSX tag '${memberProperty ?? tag.name}' imported from '${use.source}'`, node);
      }
      if ((tag.name === 'form' || tag.name === 'button' || tag.name === 'input') &&
          analysis.nodeToScope.get(node)?.getBinding(tag.name) === undefined) {
        const attributeName = tag.name === 'form' ? 'action' : 'formAction';
        for (const attribute of opening.attributes) {
          if (!ast.isJSXAttribute(attribute) || !ast.isJSXIdentifier(attribute.name) ||
              attribute.name.name !== attributeName) continue;
          if (!ast.isJSXExpressionContainer(attribute.value) ||
              !ast.isExpression(attribute.value.expression)) continue;
          const expression = attribute.value.expression;
          if (!submitValueIsFunction(expression)) continue;
          jsxOperations.push({ kind: 'form-action', opening, attribute, expression });
        }
      }
      return;
    }
  } });

  for (const use of uses) {
    if (use.binding.constantViolations.length > 0) {
      fail(`cannot reassign imported '${use.binding.name}'`, use.binding.constantViolations[0]!);
    }
    for (const reference of use.binding.references) {
      if (consumedReferences.has(reference)) continue;
      const call = hookCall(use, reference, analysis);
      const member = use.namespace ? analysis.parentByNode.get(reference) : null;
      const name = use.namespace && ast.isMemberExpression(member) &&
        ast.isIdentifier(member.property) ? member.property.name : use.name;
      if (DIAGNOSED[name] !== undefined) fail(DIAGNOSED[name], reference);
      if (name === 'startTransition' && use.source === 'react') {
        // Synchronous scope invocation is the sound lowering: MMD schedules
        // nothing, so the work runs inline. Call sites become `scope()`;
        // value positions become the scope-invoking function itself.
        if (call !== null && call.arguments.length === 1 && argument(call, 0) !== null) {
          operations.push({ kind: 'start-transition', node: call,
            argument: argument(call, 0)! });
        } else if (call === null && member !== null && ast.isMemberExpression(member)) {
          operations.push({ kind: 'start-transition', node: member as t.MemberExpression,
            argument: null });
        } else if (call === null) {
          operations.push({ kind: 'start-transition', node: reference, argument: null });
        } else {
          fail(`requires startTransition(scope) with exactly one callback`, call);
        }
        continue;
      }
      const reactDomHook = use.source === 'react-dom' && name === 'useInsertionEffect';
      if (call === null || (use.source !== 'react' && !reactDomHook) ||
          !accepted.has(name as HookName)) {
        fail(`has no MMD translation for '${use.source}.${name}' at this use`, reference);
      }
      if (seenCalls.has(call)) continue;
      seenCalls.add(call);
      if (name === 'useDebugValue') {
        const statement = ast.isExpressionStatement(analysis.parentByNode.get(call as BaseNode)) &&
          (analysis.parentByNode.get(call as BaseNode) as t.ExpressionStatement).expression === call
          ? analysis.parentByNode.get(call as BaseNode) as t.ExpressionStatement : null;
        if (statement === null || call.arguments.length > 2 ||
            call.arguments.some((arg) => !ast.isExpression(arg))) {
          fail(`requires a standalone useDebugValue(value, optionalFormatter) statement`, call);
        }
        operations.push({ kind: 'debug-value', statement });
        continue;
      }
      const owner = componentOwner(analysis, call);
      if (owner === null) {
        fail(`requires '${name}' in a top-level JSX component; custom hook and nested call ownership is not implemented`, call);
      }
      const parent = analysis.parentByNode.get(call as BaseNode);
      if (name === 'useState' || name === 'useReducer') {
        const declarator = ast.isVariableDeclarator(parent) && parent.init === call ? parent : null;
        const statement = declarator === null ? null : analysis.parentByNode.get(declarator as BaseNode);
        if (declarator === null || !ast.isArrayPattern(declarator.id) ||
            !ast.isVariableDeclaration(statement) || statement.declarations.length !== 1 ||
            analysis.parentByNode.get(statement as BaseNode) !== owner.body ||
            call.arguments.length > (name === 'useState' ? 1 : 3)) {
          fail(`requires a direct component declaration: const [value, setValue] = ${name}(...)`, call);
        }
        const elements = declarator.id.elements;
        if (elements.length < 1 || elements.length > 2 ||
            elements.every((element) => element === null) ||
            elements.some((element) => element !== null && !ast.isIdentifier(element))) {
          fail(`requires named state and optional setter bindings`, call);
        }
        const [state, setter] = elements;
        if (ast.isIdentifier(state) && ast.isIdentifier(setter) && state.name === setter.name) {
          fail(`requires distinct state and setter names`, call);
        }
        if (name === 'useState') {
          const initial = argument(call, 0);
          if (call.arguments.length === 1 && initial === null) fail(`requires an expression initializer`, call);
          if (initial !== null && (ast.isArrowFunctionExpression(initial) || ast.isFunctionExpression(initial)) &&
              returnedExpression(initial) === null) {
            fail(`requires a synchronous zero-argument lazy initializer with one returned expression`, initial);
          }
        } else if (call.arguments.length < 2 || argument(call, 0) === null ||
            argument(call, 1) === null ||
            (call.arguments.length === 3 && argument(call, 2) === null)) {
          fail(`requires useReducer(reducer, initialArg, optionalInit)`, call);
        }
        operations.push({ kind: name === 'useState' ? 'state' : 'reducer',
          statement, call,
          state: ast.isIdentifier(state) ? state.name : null,
          setter: ast.isIdentifier(setter) ? setter.name : null, owner });
      } else if (name === 'useRef') {
        const declarator = ast.isVariableDeclarator(parent) && parent.init === call ? parent : null;
        const statement = declarator === null ? null : analysis.parentByNode.get(declarator as BaseNode);
        if (declarator === null || !ast.isIdentifier(declarator.id) ||
            !ast.isVariableDeclaration(statement) || statement.declarations.length !== 1 ||
            analysis.parentByNode.get(statement as BaseNode) !== owner.body ||
            call.arguments.length > 1 ||
            (call.arguments.length === 1 && argument(call, 0) === null)) {
          fail(`requires a direct component binding: const ref = useRef(initial)`, call);
        }
        operations.push({ kind: 'ref', declarator, call });
      } else if (name === 'useSyncExternalStore') {
        const declarator = ast.isVariableDeclarator(parent) && parent.init === call ? parent : null;
        const statement = declarator === null ? null : analysis.parentByNode.get(declarator as BaseNode);
        if (declarator === null || !ast.isIdentifier(declarator.id) ||
            !ast.isVariableDeclaration(statement) || statement.declarations.length !== 1 ||
            analysis.parentByNode.get(statement as BaseNode) !== owner.body ||
            call.arguments.length !== 2 || argument(call, 0) === null ||
            argument(call, 1) === null) {
          fail(`requires a direct useSyncExternalStore(subscribe, getSnapshot) binding; the server snapshot needs a defined MMD target`, call);
        }
        if (analysis.nodeToScope.get(call as BaseNode)?.getBinding('effect') !== undefined ||
            analysis.nodeToScope.get(call as BaseNode)?.getBinding('Object') !== undefined) {
          fail(`cannot lower useSyncExternalStore while 'effect' or 'Object' is shadowed`, call);
        }
        operations.push({ kind: 'external-store', statement, owner,
          state: declarator.id.name,
          subscribe: argument(call, 0)!, getSnapshot: argument(call, 1)! });
      } else if (name === 'useMemo' || name === 'useCallback') {
        const declarator = ast.isVariableDeclarator(parent) && parent.init === call ? parent : null;
        const statement = declarator === null ? null : analysis.parentByNode.get(declarator as BaseNode);
        if (declarator === null || !ast.isIdentifier(declarator.id) ||
            !ast.isVariableDeclaration(statement) ||
            analysis.parentByNode.get(statement as BaseNode) !== owner.body ||
            call.arguments.length < 1 || call.arguments.length > 2 ||
            (call.arguments.length === 2 && !ast.isArrayExpression(call.arguments[1]))) {
          fail(`requires '${name}' as a direct component binding with an optional dependency array`, call);
        }
        const callback = argument(call, 0);
        const value = name === 'useMemo' && callback !== null
          ? returnedExpression(callback) : callback;
        if (value === null || (name === 'useCallback' &&
            !ast.isArrowFunctionExpression(value) && !ast.isFunctionExpression(value))) {
          fail(`requires '${name}' with an inline synchronous callback${name === 'useMemo' ? ' returning one expression' : ''}`, call);
        }
        operations.push({ kind: name === 'useMemo' ? 'memo' : 'callback', declarator, value });
      } else if (name === 'useEffect' || name === 'useLayoutEffect' || name === 'useInsertionEffect') {
        if (!ast.isExpressionStatement(parent) || parent.expression !== call ||
            analysis.parentByNode.get(parent as BaseNode) !== owner.body ||
            call.arguments.length < 1 || call.arguments.length > 2 ||
            (call.arguments.length === 2 && !ast.isArrayExpression(call.arguments[1])) ||
            argument(call, 0) === null) {
          fail(`requires a direct component ${name}(callback, optionalDeps) statement`, call);
        }
        if (analysis.nodeToScope.get(call as BaseNode)?.getBinding('effect') !== undefined) {
          fail(`cannot lower ${name} while 'effect' is bound in this module`, call);
        }
        // MMD runs one effect pass; React guarantees insertion < layout <
        // passive within a component, so the emitted registrations are
        // reordered by phase among their own source positions.
        const phase = name === 'useInsertionEffect' ? 0 : name === 'useLayoutEffect' ? 1 : 2;
        operations.push({ kind: 'effect', call, callback: argument(call, 0)!,
          statement: parent as t.ExpressionStatement, owner, phase });
      } else if (name === 'useDeferredValue') {
        const declarator = ast.isVariableDeclarator(parent) && parent.init === call ? parent : null;
        const statement = declarator === null ? null : analysis.parentByNode.get(declarator as BaseNode);
        if (declarator === null || !ast.isIdentifier(declarator.id) ||
            !ast.isVariableDeclaration(statement) || statement.declarations.length !== 1 ||
            analysis.parentByNode.get(statement as BaseNode) !== owner.body ||
            call.arguments.length < 1 || call.arguments.length > 2 ||
            argument(call, 0) === null) {
          fail(`requires a direct component binding: const value = useDeferredValue(value)`, call);
        }
        operations.push({ kind: 'deferred', declarator, value: argument(call, 0)! });
      } else if (name === 'useTransition') {
        const declarator = ast.isVariableDeclarator(parent) && parent.init === call ? parent : null;
        const statement = declarator === null ? null : analysis.parentByNode.get(declarator as BaseNode);
        if (declarator === null || !ast.isArrayPattern(declarator.id) ||
            !ast.isVariableDeclaration(statement) || statement.declarations.length !== 1 ||
            analysis.parentByNode.get(statement as BaseNode) !== owner.body ||
            call.arguments.length !== 0) {
          fail(`requires a direct component declaration: const [isPending, startTransition] = useTransition()`, call);
        }
        const elements = declarator.id.elements;
        if (elements.length < 1 || elements.length > 2 ||
            elements.every((element) => element === null) ||
            elements.some((element) => element !== null && !ast.isIdentifier(element))) {
          fail(`requires named pending and optional startTransition bindings`, call);
        }
        if (ast.isIdentifier(elements[0]) && ast.isIdentifier(elements[1]) &&
            elements[0].name === elements[1].name) {
          fail(`requires distinct pending and startTransition names`, call);
        }
        operations.push({ kind: 'transition', statement,
          pending: ast.isIdentifier(elements[0]) ? elements[0].name : null,
          start: ast.isIdentifier(elements[1]) ? elements[1].name : null, owner });
      } else if (name === 'useImperativeHandle') {
        if (!ast.isExpressionStatement(parent) || parent.expression !== call ||
            analysis.parentByNode.get(parent as BaseNode) !== owner.body ||
            call.arguments.length < 2 || call.arguments.length > 3 ||
            argument(call, 0) === null || argument(call, 1) === null ||
            (call.arguments.length === 3 && !ast.isArrayExpression(call.arguments[2]))) {
          fail(`requires a direct component useImperativeHandle(ref, createHandle, optionalDeps) statement`, call);
        }
        if (analysis.nodeToScope.get(call as BaseNode)?.getBinding('effect') !== undefined) {
          fail(`cannot lower useImperativeHandle while 'effect' is bound in this module`, call);
        }
        operations.push({ kind: 'imperative-handle',
          statement: parent as t.ExpressionStatement, owner,
          ref: argument(call, 0)!, create: argument(call, 1)! });
      } else if (name === 'useId') {
        const declarator = ast.isVariableDeclarator(parent) && parent.init === call ? parent : null;
        const statement = declarator === null ? null : analysis.parentByNode.get(declarator as BaseNode);
        if (declarator === null || !ast.isIdentifier(declarator.id) ||
            !ast.isVariableDeclaration(statement) || statement.declarations.length !== 1 ||
            analysis.parentByNode.get(statement as BaseNode) !== owner.body ||
            call.arguments.length !== 0) {
          fail(`requires a direct component binding: const id = useId()`, call);
        }
        operations.push({ kind: 'id', statement, name: declarator.id.name, owner });
      } else if (name === 'use') {
        const declarator = ast.isVariableDeclarator(parent) && parent.init === call ? parent : null;
        const statement = declarator === null ? null : analysis.parentByNode.get(declarator as BaseNode);
        if (declarator === null || !ast.isIdentifier(declarator.id) ||
            !ast.isVariableDeclaration(statement) || statement.declarations.length !== 1 ||
            analysis.parentByNode.get(statement as BaseNode) !== owner.body ||
            call.arguments.length !== 1 || argument(call, 0) === null) {
          fail(`requires a direct component binding: const value = use(promise); conditional or nested use() is not supported`, call);
        }
        const readTarget = argument(call, 0)!;
        if (boundToReactCall(analysis, uses, readTarget, 'createContext')) {
          const label = ast.isIdentifier(readTarget) ? readTarget.name : 'context';
          fail(`requires an ancestry-scoped context channel that MMD does not provide: use(${label}) reads a createContext() value — lift state or pass props (see assimilation/11-usecontext)`, call);
        }
        operations.push({ kind: 'read', declarator, promise: readTarget });
      } else if (name === 'useActionState') {
        const declarator = ast.isVariableDeclarator(parent) && parent.init === call ? parent : null;
        const statement = declarator === null ? null : analysis.parentByNode.get(declarator as BaseNode);
        if (declarator === null || !ast.isArrayPattern(declarator.id) ||
            !ast.isVariableDeclaration(statement) || statement.declarations.length !== 1 ||
            analysis.parentByNode.get(statement as BaseNode) !== owner.body ||
            call.arguments.length < 2 || call.arguments.length > 3 ||
            argument(call, 0) === null || argument(call, 1) === null) {
          fail(`requires a direct component declaration: const [state, dispatch, pending] = useActionState(action, initial)`, call);
        }
        const elements = declarator.id.elements;
        if (elements.length < 1 || elements.length > 3 ||
            elements.every((element) => element === null) ||
            elements.some((element) => element !== null && !ast.isIdentifier(element))) {
          fail(`requires named state, dispatch, and optional pending bindings`, call);
        }
        if (analysis.nodeToScope.get(call as BaseNode)?.getBinding('Promise') !== undefined) {
          fail(`cannot lower useActionState while 'Promise' is bound in this module`, call);
        }
        operations.push({ kind: 'action-state', statement, owner,
          action: argument(call, 0)!, initial: argument(call, 1)!,
          state: ast.isIdentifier(elements[0]) ? elements[0].name : null,
          dispatch: ast.isIdentifier(elements[1]) ? elements[1].name : null,
          pending: ast.isIdentifier(elements[2]) ? elements[2].name : null });
      }
    }
  }

  // Plan validation is complete. No source tree is changed before this point.
  const occupied = new Set<string>();
  walkAst(program as BaseNode, { enter(node) {
    if (ast.isIdentifier(node)) occupied.add(node.name);
  } });
  let serial = 0;
  const fresh = (hint: string): string => {
    let name: string;
    do { name = `__mmdReact${hint}${serial++}`; } while (occupied.has(name));
    occupied.add(name);
    return name;
  };
  const effectStatements: Array<{ owner: t.FunctionDeclaration;
    statement: t.ExpressionStatement; phase: number }> = [];
  let groupLocal: string | null = null;
  let readLocal: string | null = null;
  let formsLocal: string | null = null;
  let idHelper: string | null = null;
  for (const operation of operations) {
    if (operation.kind === 'state' || operation.kind === 'reducer') {
      const initial = argument(operation.call, operation.kind === 'state' ? 0 : 1);
      const hasReducerInit = operation.kind === 'reducer' && operation.call.arguments.length === 3;
      const initialArg = hasReducerInit ? fresh('InitialArg') : null;
      const initializer = hasReducerInit ? fresh('Initializer') : null;
      const stateInit = initialArg !== null && initializer !== null
        ? ast.callExpression(ast.identifier(initializer), [ast.identifier(initialArg)])
        : initial === null ? ast.unaryExpression('void', ast.numericLiteral(0))
        : operation.kind === 'state' &&
          (ast.isArrowFunctionExpression(initial) || ast.isFunctionExpression(initial))
          ? ast.callExpression(copy(initial), []) : copy(initial);
      const next = fresh('Next');
      const reducer = operation.kind === 'reducer' ? fresh('Reducer') : null;
      const stateName = operation.state ?? fresh('State');
      const setter = ast.arrowFunctionExpression([ast.identifier(next)], ast.blockStatement([
        ast.expressionStatement(ast.assignmentExpression('=', ast.identifier(stateName),
          reducer !== null
          ? ast.callExpression(ast.identifier(reducer), [ast.identifier(stateName), ast.identifier(next)])
          : ast.conditionalExpression(
            ast.binaryExpression('===', ast.unaryExpression('typeof', ast.identifier(next)), ast.stringLiteral('function')),
            ast.callExpression(ast.identifier(next), [ast.identifier(stateName)]),
            ast.identifier(next),
          ))),
      ]));
      const replacements = [
        ...(reducer === null ? [] : [ast.variableDeclaration('const', [
          ast.variableDeclarator(ast.identifier(reducer), copy(argument(operation.call, 0)!)),
        ])]),
        ...(initialArg === null || initializer === null ? [] : [
          ast.variableDeclaration('const', [ast.variableDeclarator(
            ast.identifier(initialArg), copy(initial!))]),
          ast.variableDeclaration('const', [ast.variableDeclarator(
            ast.identifier(initializer), copy(argument(operation.call, 2)!))]),
        ]),
        ast.variableDeclaration('let', [ast.variableDeclarator(ast.identifier(stateName), stateInit)]),
        ...(operation.setter === null ? [] : [ast.variableDeclaration('const', [
          ast.variableDeclarator(ast.identifier(operation.setter), setter)])]),
      ];
      const index = operation.owner.body.body.indexOf(operation.statement);
      operation.owner.body.body.splice(index, 1, ...replacements);
    } else if (operation.kind === 'ref') {
      const initial = argument(operation.call, 0);
      operation.declarator.init = ast.objectExpression([
        ast.objectProperty(ast.identifier('current'), initial === null
          ? ast.unaryExpression('void', ast.numericLiteral(0)) : copy(initial)),
      ]);
    } else if (operation.kind === 'external-store') {
      const subscribe = fresh('Subscribe');
      const getSnapshot = fresh('GetSnapshot');
      const next = fresh('Snapshot');
      const onChange = fresh('OnChange');
      const unsubscribe = fresh('Unsubscribe');
      const update = ast.arrowFunctionExpression([], ast.blockStatement([
        ast.variableDeclaration('const', [ast.variableDeclarator(ast.identifier(next),
          ast.callExpression(ast.identifier(getSnapshot), []))]),
        ast.ifStatement(ast.unaryExpression('!', ast.callExpression(
          ast.memberExpression(ast.identifier('Object'), ast.identifier('is')),
          [ast.identifier(operation.state), ast.identifier(next)],
        )), ast.blockStatement([
          ast.expressionStatement(ast.assignmentExpression('=', ast.identifier(operation.state),
            ast.identifier(next))),
        ])),
      ]));
      const effect = ast.callExpression(ast.identifier('effect'), [
        ast.arrowFunctionExpression([], ast.blockStatement([
          ast.variableDeclaration('const', [ast.variableDeclarator(ast.identifier(onChange), update)]),
          ast.variableDeclaration('const', [ast.variableDeclarator(ast.identifier(unsubscribe),
            ast.callExpression(ast.identifier(subscribe), [ast.identifier(onChange)]))]),
          ast.expressionStatement(ast.callExpression(ast.identifier(onChange), [])),
          ast.returnStatement(ast.identifier(unsubscribe)),
        ])),
      ]);
      const effectStatement = ast.expressionStatement(effect);
      effectStatements.push({ owner: operation.owner, statement: effectStatement, phase: 2 });
      const replacements = [
        ast.variableDeclaration('const', [ast.variableDeclarator(ast.identifier(subscribe), copy(operation.subscribe))]),
        ast.variableDeclaration('const', [ast.variableDeclarator(ast.identifier(getSnapshot), copy(operation.getSnapshot))]),
        ast.variableDeclaration('let', [ast.variableDeclarator(ast.identifier(operation.state),
          ast.callExpression(ast.identifier(getSnapshot), []))]),
        effectStatement,
      ];
      const index = operation.owner.body.body.indexOf(operation.statement);
      operation.owner.body.body.splice(index, 1, ...replacements);
    } else if (operation.kind === 'memo' || operation.kind === 'callback') {
      operation.declarator.init = copy(operation.value);
    } else if (operation.kind === 'effect') {
      operation.call.callee = ast.identifier('effect');
      operation.call.arguments = [copy(operation.callback)];
      effectStatements.push({ owner: operation.owner, statement: operation.statement,
        phase: operation.phase });
    } else if (operation.kind === 'debug-value') {
      removeNode(analysis, operation.statement as BaseNode);
    } else if (operation.kind === 'deferred') {
      operation.declarator.init = copy(operation.value);
    } else if (operation.kind === 'transition') {
      const scope = fresh('Scope');
      const replacements: t.Statement[] = [];
      if (operation.pending !== null) {
        replacements.push(ast.variableDeclaration('const', [ast.variableDeclarator(
          ast.identifier(operation.pending), ast.booleanLiteral(false))]));
      }
      if (operation.start !== null) {
        replacements.push(ast.variableDeclaration('const', [ast.variableDeclarator(
          ast.identifier(operation.start),
          ast.arrowFunctionExpression([ast.identifier(scope)],
            ast.callExpression(ast.identifier(scope), [])))]));
      }
      const index = operation.owner.body.body.indexOf(operation.statement);
      operation.owner.body.body.splice(index, 1, ...replacements);
    } else if (operation.kind === 'imperative-handle') {
      const target = fresh('ImperativeRef');
      const create = fresh('ImperativeCreate');
      const handle = fresh('Handle');
      const targetCurrent = (): t.MemberExpression =>
        ast.memberExpression(ast.identifier(target), ast.identifier('current'));
      // Callable refs receive the handle and are cleared with `null` (a
      // returned function is honoured as explicit cleanup, React 19 style);
      // `{current}` boxes are written and cleared only if unchanged.
      const cleanup = fresh('ImperativeCleanup');
      const effectStatement = ast.expressionStatement(ast.callExpression(
        ast.identifier('effect'), [
          ast.arrowFunctionExpression([], ast.blockStatement([
            ast.ifStatement(
              ast.binaryExpression('==', ast.identifier(target), ast.nullLiteral()),
              ast.blockStatement([ast.returnStatement()])),
            ast.variableDeclaration('const', [ast.variableDeclarator(ast.identifier(handle),
              ast.callExpression(ast.identifier(create), []))]),
            ast.ifStatement(
              ast.binaryExpression('===',
                ast.unaryExpression('typeof', ast.identifier(target)),
                ast.stringLiteral('function')),
              ast.blockStatement([
                ast.variableDeclaration('const', [ast.variableDeclarator(
                  ast.identifier(cleanup),
                  ast.callExpression(ast.identifier(target), [ast.identifier(handle)]))]),
                ast.returnStatement(ast.arrowFunctionExpression([], ast.blockStatement([
                  ast.ifStatement(
                    ast.binaryExpression('===',
                      ast.unaryExpression('typeof', ast.identifier(cleanup)),
                      ast.stringLiteral('function')),
                    ast.blockStatement([ast.returnStatement(
                      ast.callExpression(ast.identifier(cleanup), []))])),
                  ast.expressionStatement(ast.callExpression(ast.identifier(target),
                    [ast.nullLiteral()])),
                ]))),
              ])),
            ast.expressionStatement(ast.assignmentExpression('=', targetCurrent(),
              ast.identifier(handle))),
            ast.returnStatement(ast.arrowFunctionExpression([], ast.blockStatement([
              ast.ifStatement(
                ast.binaryExpression('===', targetCurrent(), ast.identifier(handle)),
                ast.blockStatement([ast.expressionStatement(ast.assignmentExpression('=',
                  targetCurrent(), ast.nullLiteral()))])),
            ]))),
          ])),
        ]));
      const index = operation.owner.body.body.indexOf(operation.statement);
      operation.owner.body.body.splice(index, 1,
        ast.variableDeclaration('const', [ast.variableDeclarator(ast.identifier(target),
          copy(operation.ref))]),
        ast.variableDeclaration('const', [ast.variableDeclarator(ast.identifier(create),
          copy(operation.create))]),
        effectStatement);
      effectStatements.push({ owner: operation.owner, statement: effectStatement, phase: 1 });
    } else if (operation.kind === 'id') {
      const helper = idHelper ??= fresh('UseId');
      const index = operation.owner.body.body.indexOf(operation.statement);
      operation.owner.body.body.splice(index, 1,
        ast.variableDeclaration('let', [ast.variableDeclarator(
          ast.identifier(operation.name), ast.stringLiteral(''))]),
        ast.expressionStatement(ast.assignmentExpression('=',
          ast.identifier(operation.name),
          ast.callExpression(ast.identifier(helper), []))));
    } else if (operation.kind === 'read') {
      const local = readLocal ??= fresh('Read');
      operation.declarator.init = ast.callExpression(ast.identifier(local),
        [copy(operation.promise)]);
    } else if (operation.kind === 'action-state') {
      const action = fresh('FormAction');
      const form = fresh('Form');
      const fields = fresh('Fields');
      const next = fresh('Next');
      const state = fresh('ActionState');
      const submit = ast.arrowFunctionExpression([ast.identifier(fields)],
        ast.callExpression(
          ast.memberExpression(
            ast.callExpression(
              ast.memberExpression(
                ast.callExpression(ast.memberExpression(ast.identifier('Promise'),
                  ast.identifier('resolve')), []),
                ast.identifier('then')),
              [ast.arrowFunctionExpression([], ast.callExpression(ast.identifier(action),
                [ast.identifier(state), ast.identifier(fields)]))]),
            ast.identifier('then')),
          [ast.arrowFunctionExpression([ast.identifier(next)],
            ast.assignmentExpression('=', ast.identifier(state),
              ast.identifier(next)))]));
      const replacements: t.Statement[] = [
        ast.variableDeclaration('let', [ast.variableDeclarator(ast.identifier(state),
          copy(operation.initial))]),
        ast.variableDeclaration('const', [ast.variableDeclarator(ast.identifier(action),
          copy(operation.action))]),
        ast.variableDeclaration('const', [ast.variableDeclarator(ast.identifier(form),
          ast.callExpression(ast.identifier(formsLocal ??= fresh('Forms')), [submit]))]),
      ];
      if (operation.state !== null) {
        replacements.push(ast.variableDeclaration('const', [ast.variableDeclarator(
          ast.identifier(operation.state), ast.identifier(state))]));
      }
      if (operation.dispatch !== null) {
        replacements.push(ast.variableDeclaration('const', [ast.variableDeclarator(
          ast.identifier(operation.dispatch),
          ast.memberExpression(ast.identifier(form), ast.identifier('submit')))]));
      }
      if (operation.pending !== null) {
        replacements.push(ast.variableDeclaration('const', [ast.variableDeclarator(
          ast.identifier(operation.pending),
          ast.memberExpression(ast.identifier(form), ast.identifier('pending')))]));
      }
      const index = operation.owner.body.body.indexOf(operation.statement);
      operation.owner.body.body.splice(index, 1, ...replacements);
    } else if (operation.kind === 'start-transition') {
      const scope = fresh('Scope');
      replaceNode(analysis, operation.node,
        operation.argument !== null
          ? ast.callExpression(copy(operation.argument), []) as unknown as BaseNode
          : ast.arrowFunctionExpression([ast.identifier(scope)],
              ast.callExpression(ast.identifier(scope), [])) as unknown as BaseNode);
    }
  }
  for (const operation of jsxOperations) {
    if (operation.kind === 'group') {
      const local = groupLocal ??= fresh('Group');
      const { openingElement: opening, closingElement: closing } = operation.element;
      opening.name = ast.jsxIdentifier(local);
      if (closing !== null) closing.name = ast.jsxIdentifier(local);
      const attributes: Array<t.JSXAttribute | t.JSXSpreadAttribute> = [];
      for (const attribute of opening.attributes) {
        if (ast.isJSXAttribute(attribute) && ast.isJSXIdentifier(attribute.name) &&
            attribute.name.name === 'fallback') {
          if (ast.isJSXExpressionContainer(attribute.value) &&
              !ast.isJSXEmptyExpression(attribute.value.expression)) {
            const expression = attribute.value.expression as t.Expression;
            if (ast.isNullLiteral(expression) ||
                (ast.isIdentifier(expression) && expression.name === 'undefined')) continue;
            // <X/> lowers to the component slot value; any other expression
            // becomes a zero-arg template so pending={...} stays declarative.
            const slot = ast.isJSXElement(expression) &&
                ast.isJSXIdentifier(expression.openingElement.name) &&
                /^[A-Z]/.test(expression.openingElement.name.name) &&
                expression.openingElement.attributes.length === 0 &&
                expression.children.length === 0
              ? ast.identifier(expression.openingElement.name.name)
              : ast.isIdentifier(expression) || ast.isMemberExpression(expression) ||
                ast.isCallExpression(expression)
              ? expression
              : ast.arrowFunctionExpression([], expression);
            attributes.push(ast.jsxAttribute(ast.jsxIdentifier('pending'),
              ast.jsxExpressionContainer(slot)));
          }
          continue;
        }
        attributes.push(attribute);
      }
      attributes.push(ast.jsxAttribute(ast.jsxIdentifier('suspend')));
      opening.attributes = attributes;
    } else if (operation.kind === 'unwrap') {
      replaceNode(analysis, operation.element as BaseNode, ast.jsxFragment(
        ast.jsxOpeningFragment(), ast.jsxClosingFragment(),
        operation.element.children) as unknown as BaseNode);
    } else if (operation.kind === 'form-action') {
      const event = fresh('SubmitEvent');
      const target = ast.memberExpression(ast.identifier(event), ast.identifier('currentTarget'));
      const data = ast.isJSXIdentifier(operation.attribute.name) &&
          operation.attribute.name.name === 'formAction'
        ? ast.newExpression(ast.identifier('FormData'), [
            ast.logicalExpression('??',
              ast.memberExpression(target, ast.identifier('form')),
              ast.identifier('undefined')),
            target])
        : ast.conditionalExpression(
            ast.binaryExpression('===',
              ast.memberExpression(ast.identifier(event), ast.identifier('submitter')),
              ast.nullLiteral()),
            ast.newExpression(ast.identifier('FormData'), [target]),
            ast.newExpression(ast.identifier('FormData'), [
              target,
              ast.memberExpression(ast.identifier(event), ast.identifier('submitter')),
            ]));
      const invoke = ast.expressionStatement(ast.callExpression(
        operation.expression, [data]));
      const prevent = ast.expressionStatement(ast.callExpression(
        ast.memberExpression(ast.identifier(event), ast.identifier('preventDefault')), []));
      const handlerName = ast.isJSXIdentifier(operation.attribute.name) &&
          operation.attribute.name.name === 'formAction' ? 'onClick' : 'onSubmit';
      const existing = operation.opening.attributes.find((attribute) =>
        ast.isJSXAttribute(attribute) && ast.isJSXIdentifier(attribute.name) &&
        attribute.name.name === handlerName) as t.JSXAttribute | undefined;
      const previous = existing !== undefined &&
          ast.isJSXExpressionContainer(existing.value) &&
          ast.isExpression(existing.value.expression)
        ? existing.value.expression : null;
      const handler = ast.arrowFunctionExpression([ast.identifier(event)],
        ast.blockStatement(previous === null ? [prevent, invoke] : [
          ast.expressionStatement(ast.callExpression(previous, [ast.identifier(event)])),
          ast.ifStatement(
            ast.memberExpression(ast.identifier(event), ast.identifier('defaultPrevented')),
            ast.returnStatement()),
          prevent,
          invoke,
        ]));
      if (existing !== undefined) {
        existing.value = ast.jsxExpressionContainer(handler);
        operation.opening.attributes = operation.opening.attributes.filter(
          (attribute) => attribute !== operation.attribute);
      } else {
        operation.attribute.name = ast.jsxIdentifier(handlerName);
        operation.attribute.value = ast.jsxExpressionContainer(handler);
      }
    }
  }
  // Keep React's effect-phase guarantee inside the single MMD pass: insertion
  // effects register before layout effects, which register before passive
  // ones, permuting only the positions those statements already occupy.
  const statementsByOwner = new Map<t.FunctionDeclaration,
    Array<{ owner: t.FunctionDeclaration; statement: t.ExpressionStatement; phase: number }>>();
  for (const entry of effectStatements) {
    const list = statementsByOwner.get(entry.owner);
    if (list === undefined) statementsByOwner.set(entry.owner, [entry]);
    else list.push(entry);
  }
  for (const entries of statementsByOwner.values()) {
    const body = entries[0]!.owner.body.body;
    const positions = entries.map((entry) => body.indexOf(entry.statement)).sort((a, b) => a - b);
    entries
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => a.entry.phase - b.entry.phase || a.index - b.index)
      .forEach(({ entry }, i) => { body[positions[i]!] = entry.statement; });
  }
  const injected: t.Statement[] = [];
  if (idHelper !== null) {
    const serial = fresh('IdSerial');
    const current = fresh('Id');
    injected.push(
      ast.variableDeclaration('let', [ast.variableDeclarator(ast.identifier(serial),
        ast.numericLiteral(0))]),
      ast.functionDeclaration(ast.identifier(idHelper), [], ast.blockStatement([
        ast.variableDeclaration('const', [ast.variableDeclarator(ast.identifier(current),
          ast.identifier(serial))]),
        ast.expressionStatement(ast.assignmentExpression('=', ast.identifier(serial),
          ast.binaryExpression('+', ast.identifier(serial), ast.numericLiteral(1)))),
        ast.returnStatement(ast.binaryExpression('+', ast.stringLiteral('r'),
          ast.identifier(current))),
      ])));
  }
  const importedHelpers: t.ImportSpecifier[] = [];
  if (readLocal !== null) {
    importedHelpers.push(ast.importSpecifier(ast.identifier(readLocal), ast.identifier('$read')));
  }
  if (groupLocal !== null) {
    importedHelpers.push(ast.importSpecifier(ast.identifier(groupLocal), ast.identifier('Group')));
  }
  if (formsLocal !== null) {
    importedHelpers.push(ast.importSpecifier(ast.identifier(formsLocal), ast.identifier('$forms')));
  }
  if (importedHelpers.length > 0) {
    injected.unshift(ast.importDeclaration(importedHelpers,
      ast.stringLiteral('@memoized-dom/data')));
    // Injected imports are added after link classification; mark them linked
    // like any value arriving from an external package manifest.
    for (const local of [readLocal, groupLocal, formsLocal]) {
      if (local !== null) ctx.importedValues.add(local);
    }
  }
  if (injected.length > 0) {
    let insertAt = 0;
    while (insertAt < program.body.length &&
        (ast.isImportDeclaration(program.body[insertAt]) ||
          (ast.isExpressionStatement(program.body[insertAt]) &&
            ast.isStringLiteral((program.body[insertAt] as t.ExpressionStatement).expression)))) {
      insertAt++;
    }
    program.body.splice(insertAt, 0, ...injected);
  }
  // Every live imported React binding was either translated or diagnosed.
  // Erase those imports so compiled modules have no React runtime dependency.
  program.body = program.body.filter((statement) => !imports.includes(statement as t.ImportDeclaration));
}
