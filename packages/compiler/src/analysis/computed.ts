import { walkAst, type BaseNode } from '../ast';
import {
  registerState,
  type ComputedAnalysis,
  type Ctx,
} from '../context';
import { summarizeHelper } from '../helper-summaries';

const FUNCTION_NODES = new Set([
  'ArrowFunctionExpression',
  'FunctionDeclaration',
  'FunctionExpression',
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod',
]);

const TYPE_WRAPPERS = new Set([
  'TSAsExpression',
  'TSTypeAssertion',
  'TSNonNullExpression',
  'TSSatisfiesExpression',
  'TSInstantiationExpression',
]);

interface ProgramPathLike {
  node: BaseNode;
}

function field(node: BaseNode, name: string): unknown {
  return (node as unknown as Record<string, unknown>)[name];
}

function isNode(value: unknown): value is BaseNode {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

function childNode(node: BaseNode, name: string): BaseNode | null {
  const value = field(node, name);
  return isNode(value) ? value : null;
}

function childNodes(node: BaseNode, name: string): BaseNode[] {
  const value = field(node, name);
  return Array.isArray(value) ? value.filter(isNode) : [];
}

function identifierName(node: BaseNode | null): string | null {
  if (node?.type !== 'Identifier') return null;
  const name = field(node, 'name');
  return typeof name === 'string' ? name : null;
}

function unwrapTypes(node: BaseNode): BaseNode {
  let current = node;
  while (TYPE_WRAPPERS.has(current.type)) {
    const expression = childNode(current, 'expression');
    if (expression === null) break;
    current = expression;
  }
  return current;
}

function isMember(node: BaseNode): boolean {
  return (
    node.type === 'MemberExpression' ||
    node.type === 'OptionalMemberExpression'
  );
}

function memberRootName(node: BaseNode): string | null {
  let current = node;
  while (true) {
    if (isMember(current)) {
      const object = childNode(current, 'object');
      if (object === null || object.type === 'Super') return null;
      current = object;
      continue;
    }
    const unwrapped = unwrapTypes(current);
    if (unwrapped !== current) {
      current = unwrapped;
      continue;
    }
    return identifierName(current);
  }
}

function stringLiteralValue(node: BaseNode | null): string | null {
  if (node === null) return null;
  if (node.type !== 'StringLiteral' && node.type !== 'Literal') return null;
  const value = field(node, 'value');
  return typeof value === 'string' ? value : null;
}

function memberKey(node: BaseNode): string | null {
  const parts: string[] = [];
  let current = node;
  while (isMember(current)) {
    const property = childNode(current, 'property');
    const part =
      field(current, 'computed') === true
        ? stringLiteralValue(property)
        : identifierName(property);
    if (part === null) return null;
    parts.unshift(part);
    const object = childNode(current, 'object');
    if (object === null || object.type === 'Super') return null;
    current = object;
  }
  current = unwrapTypes(current);
  const root = identifierName(current);
  if (root === null) return null;
  parts.unshift(root);
  return parts.join('.');
}

/**
 * Analyze a candidate module-level computed initializer. Detection is by
 * reactive-state reference rather than by a whitelist of expression forms.
 */
export function analyzeComputed(ctx: Ctx, expr: BaseNode): ComputedAnalysis {
  const reads = new Set<string>();
  let impure = false;
  let reason: string | undefined;
  const locals = new Set<string>();
  const fail = (message: string): void => {
    if (!impure) {
      impure = true;
      reason = message;
    }
  };
  const noteLocalPattern = (pattern: BaseNode): void => {
    walkAst(pattern, {
      enter(node) {
        const name = identifierName(node);
        if (name !== null) locals.add(name);
      },
    });
  };

  walkAst(expr, {
    enter(node, parent) {
      if (FUNCTION_NODES.has(node.type)) {
        const executesAsPartOfExpression =
          parent !== null &&
          (parent.type === 'CallExpression' || parent.type === 'NewExpression');
        if (!executesAsPartOfExpression) return false;
        for (const param of childNodes(node, 'params')) noteLocalPattern(param);
        return;
      }
      if (node.type === 'VariableDeclarator') {
        const id = childNode(node, 'id');
        if (id !== null) noteLocalPattern(id);
        return;
      }
      if (node.type === 'AssignmentExpression') {
        const left = childNode(node, 'left');
        const root =
          identifierName(left) ??
          (left !== null && isMember(left) ? memberRootName(left) : null);
        if (root === null || !locals.has(root)) {
          fail('contains an assignment: writes belong in handlers, not derivations');
        }
        return;
      }
      if (node.type === 'UpdateExpression') {
        const argument = childNode(node, 'argument');
        const root =
          identifierName(argument) ??
          (argument !== null && isMember(argument)
            ? memberRootName(argument)
            : null);
        if (root === null || !locals.has(root)) {
          fail('contains an update (++/--): writes belong in handlers, not derivations');
        }
        return;
      }
      if (node.type === 'AwaitExpression' || node.type === 'YieldExpression') {
        fail('uses await/yield: derivations must be synchronous');
        return;
      }
      if (node.type === 'CallExpression') {
        const callee = identifierName(childNode(node, 'callee'));
        if (
          callee !== null &&
          (ctx.helpers.has(callee) || ctx.importedFunctions.has(callee))
        ) {
          const summary =
            ctx.importedFunctions.get(callee) ?? summarizeHelper(ctx, callee);
          for (const read of summary.reads) reads.add(read);
          if (summary.writes.size > 0) {
            for (const write of summary.writes) reads.add(write);
            fail(
              `calls helper '${callee}' which writes state: writes belong in handlers`,
            );
          } else if (summary.unbounded && ctx.helpers.has(callee)) {
            fail(`calls recursive helper '${callee}' which cannot be analyzed`);
          }
        }
        return;
      }
      const name = identifierName(node);
      if (name !== null) {
        if (!locals.has(name) && ctx.state.has(name)) reads.add(name);
        return;
      }
      if (node.type === 'MemberExpression' && field(node, 'computed') !== true) {
        const key = memberKey(node);
        if (key !== null && key.includes('.')) {
          const root = key.split('.')[0]!;
          if (!locals.has(root) && ctx.state.get(root) === 'store') {
            reads.add(key);
          }
        }
      }
    },
  });

  return { reads, impure, reason };
}

/** Discover ordered module-level const derivations after module state exists. */
export function scanComputeds(ctx: Ctx, programPath: ProgramPathLike): void {
  for (const statement of childNodes(programPath.node, 'body')) {
    const inner =
      statement.type === 'ExportNamedDeclaration'
        ? childNode(statement, 'declaration')
        : statement;
    if (inner?.type !== 'VariableDeclaration' || field(inner, 'kind') !== 'const') {
      continue;
    }
    for (const declaration of childNodes(inner, 'declarations')) {
      const id = childNode(declaration, 'id');
      const init = childNode(declaration, 'init');
      const name = identifierName(id);
      if (name === null || init === null) continue;
      if (ctx.state.get(name) === 'let' || ctx.state.get(name) === 'computed') {
        continue;
      }
      if (
        FUNCTION_NODES.has(init.type) ||
        init.type === 'JSXElement' ||
        init.type === 'JSXFragment'
      ) {
        continue;
      }
      const result = analyzeComputed(ctx, init);
      if (result.impure) {
        if (result.reads.size > 0) {
          throw new Error(
            `memo-dom: const '${name}' is a state derivation but ${
              result.reason ?? 'cannot be analyzed'
            }. Fix the derivation, or make it a 'let' you update in handlers.`,
          );
        }
        continue;
      }
      if (result.reads.size === 0) continue;
      registerState(ctx, name, 'computed');
      ctx.computeds.set(name, { reads: result.reads });
    }
  }
}
