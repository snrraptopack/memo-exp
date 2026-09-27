/**
 * React source is an input dialect. A validated plan translates its supported
 * operations into ordinary MMD component syntax before shared analysis runs.
 * No React hook dispatcher or element object is emitted.
 */
import type * as t from '../ast/compiler-types';
import * as ast from '../ast/factory';
import { analyzeScope, cloneNode, walkAst, type BaseNode } from '../ast';
import { nodeHasJsx, type ProgramPath } from '../context';

type HookName = 'useState' | 'useReducer' | 'useRef' | 'useMemo' | 'useCallback' |
  'useEffect' | 'useSyncExternalStore';
function isReactSpecifier(source: string): boolean {
  return source === 'react' || source.startsWith('react/') ||
    source === 'react-dom' || source.startsWith('react-dom/');
}
type Operation =
  | { kind: 'state' | 'reducer'; statement: t.VariableDeclaration; call: t.CallExpression;
      state: string; setter: string; owner: t.FunctionDeclaration }
  | { kind: 'external-store'; statement: t.VariableDeclaration;
      owner: t.FunctionDeclaration; state: string; subscribe: t.Expression;
      getSnapshot: t.Expression }
  | { kind: 'ref'; declarator: t.VariableDeclarator; call: t.CallExpression }
  | { kind: 'memo'; declarator: t.VariableDeclarator; value: t.Expression }
  | { kind: 'callback'; declarator: t.VariableDeclarator;
      value: t.Expression }
  | { kind: 'effect'; call: t.CallExpression; callback: t.Expression };

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
export function assimilateReactSource(programPath: ProgramPath): void {
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
    'useSyncExternalStore',
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
  walkAst(program as BaseNode, { enter(node) {
    if (node.type !== 'JSXOpeningElement') return;
    let tag: t.JSXOpeningElement['name'] = (node as t.JSXOpeningElement).name;
    while (tag.type === 'JSXMemberExpression') tag = tag.object;
    if (tag.type !== 'JSXIdentifier') return;
    const use = importedByName.get(tag.name);
    if (use !== undefined && analysis.nodeToScope.get(node)?.getBinding(tag.name) === use.binding) {
      fail(`has no MMD translation for JSX tag '${tag.name}' imported from '${use.source}'`, node);
    }
  } });

  for (const use of uses) {
    if (use.binding.constantViolations.length > 0) {
      fail(`cannot reassign imported '${use.binding.name}'`, use.binding.constantViolations[0]!);
    }
    for (const reference of use.binding.references) {
      const call = hookCall(use, reference, analysis);
      const member = use.namespace ? analysis.parentByNode.get(reference) : null;
      const name = use.namespace && ast.isMemberExpression(member) &&
        ast.isIdentifier(member.property) ? member.property.name : use.name;
      if (call === null || use.source !== 'react' || !accepted.has(name as HookName)) {
        fail(`has no MMD translation for '${use.source}.${name}' at this use`, reference);
      }
      if (seenCalls.has(call)) continue;
      seenCalls.add(call);
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
        if (elements.length !== 2 || !ast.isIdentifier(elements[0]) || !ast.isIdentifier(elements[1])) {
          fail(`requires two named state and setter bindings`, call);
        }
        const [state, setter] = elements as [t.Identifier, t.Identifier];
        if (state.name === setter.name) fail(`requires distinct state and setter names`, call);
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
          statement, call, state: state.name, setter: setter.name, owner });
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
      } else if (name === 'useEffect') {
        if (!ast.isExpressionStatement(parent) || parent.expression !== call ||
            analysis.parentByNode.get(parent as BaseNode) !== owner.body ||
            call.arguments.length < 1 || call.arguments.length > 2 ||
            (call.arguments.length === 2 && !ast.isArrayExpression(call.arguments[1])) ||
            argument(call, 0) === null) {
          fail(`requires a direct component useEffect(callback, optionalDeps) statement`, call);
        }
        if (analysis.nodeToScope.get(call as BaseNode)?.getBinding('effect') !== undefined) {
          fail(`cannot lower useEffect while 'effect' is bound in this module`, call);
        }
        operations.push({ kind: 'effect', call, callback: argument(call, 0)! });
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
      const setter = ast.arrowFunctionExpression([ast.identifier(next)], ast.blockStatement([
        ast.expressionStatement(ast.assignmentExpression('=', ast.identifier(operation.state),
          reducer !== null
          ? ast.callExpression(ast.identifier(reducer), [ast.identifier(operation.state), ast.identifier(next)])
          : ast.conditionalExpression(
            ast.binaryExpression('===', ast.unaryExpression('typeof', ast.identifier(next)), ast.stringLiteral('function')),
            ast.callExpression(ast.identifier(next), [ast.identifier(operation.state)]),
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
        ast.variableDeclaration('let', [ast.variableDeclarator(ast.identifier(operation.state), stateInit)]),
        ast.variableDeclaration('const', [ast.variableDeclarator(ast.identifier(operation.setter), setter)]),
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
      const replacements = [
        ast.variableDeclaration('const', [ast.variableDeclarator(ast.identifier(subscribe), copy(operation.subscribe))]),
        ast.variableDeclaration('const', [ast.variableDeclarator(ast.identifier(getSnapshot), copy(operation.getSnapshot))]),
        ast.variableDeclaration('let', [ast.variableDeclarator(ast.identifier(operation.state),
          ast.callExpression(ast.identifier(getSnapshot), []))]),
        ast.expressionStatement(effect),
      ];
      const index = operation.owner.body.body.indexOf(operation.statement);
      operation.owner.body.body.splice(index, 1, ...replacements);
    } else if (operation.kind === 'memo' || operation.kind === 'callback') {
      operation.declarator.init = copy(operation.value);
    } else if (operation.kind === 'effect') {
      operation.call.callee = ast.identifier('effect');
      operation.call.arguments = [copy(operation.callback)];
    }
  }
  // Every live imported React binding was either translated or diagnosed.
  // Erase those imports so compiled modules have no React runtime dependency.
  program.body = program.body.filter((statement) => !imports.includes(statement as t.ImportDeclaration));
}
