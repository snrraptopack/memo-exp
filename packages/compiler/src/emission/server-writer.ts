/**
 * Experimental retained leaf writer. Derive it from the already-lowered
 * creation/update plan, never re-run authored JSX at serialization time.
 * Unsupported node operations reject the whole candidate before mutation.
 */
import type * as t from '../ast/compiler-types';
import * as f from '../ast/factory';
import { cloneNode } from '../ast';
import type { Ctx } from '../context';
import { generatedIdentifier, md } from '../identifiers';
import type { EmitScope } from './scope';

// A bounded proof surface: HTML leaf elements, text and class snapshots,
// static scalar attributes. Foreign/form/raw-text/custom elements fall back.
const TAGS = new Set(['div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'tr', 'td', 'th',
  'li', 'ul', 'ol', 'a', 'strong', 'em', 'b', 'i', 'small', 'section', 'article',
  'header', 'footer', 'nav']);
interface Shape {
  name: string;
  tag: string | null;
  text: string;
  children: string[];
  attributes: Array<[string, string]>;
}

function escape(value: string, attribute = false): string {
  const text = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return attribute ? text.replace(/"/g, '&quot;') : text;
}

/** Capture before template/markup rewrites; finalize with the full updater. */
export function prepareServerWriter(
  ctx: Ctx, scope: EmitScope, root: string,
): ((update: t.Statement, result: t.ReturnStatement) => t.Statement | null) | null {
  if (!ctx.ssrWriter || scope.documentVar === null || scope.mounts.length ||
      scope.disposableRegions.length || scope.disposableEntities.length ||
      scope.disposableCallbacks.length || scope.delegatedEventBindings.size) return null;
  const shapes = new Map<string, Shape>();
  const creation: t.Statement[] = [];
  const linked = new Set<string>();
  for (const statement of scope.creation) {
    if (!f.isVariableDeclaration(statement)) continue;
    if (statement.declarations.length !== 1) return null;
    const decl = statement.declarations[0]!;
    const call = decl.init;
    if (!f.isIdentifier(decl.id) || !f.isCallExpression(call) ||
        !f.isMemberExpression(call.callee) ||
        !f.isIdentifier(call.callee.object, { name: scope.documentVar }) ||
        !f.isIdentifier(call.callee.property) || call.arguments.length !== 1 ||
        !f.isStringLiteral(call.arguments[0])) return null;
    const method = call.callee.property.name;
    const value = call.arguments[0].value;
    if (method !== 'createTextNode' && (method !== 'createElement' || !TAGS.has(value))) return null;
    shapes.set(decl.id.name, { name: decl.id.name, tag: method === 'createTextNode' ? null : value,
      text: method === 'createTextNode' ? value : '', children: [], attributes: [] });
  }
  if (!shapes.get(root)?.tag || shapes.size < 2) return null;
  for (const statement of scope.creation) {
    if (f.isVariableDeclaration(statement)) {
      const shape = shapes.get((statement.declarations[0]!.id as t.Identifier).name)!;
      if (shape.tag === null) creation.push(f.variableDeclaration('let', [
        f.variableDeclarator(f.identifier(shape.name), f.stringLiteral(shape.text)),
      ]));
      continue;
    }
    const call = f.isExpressionStatement(statement) && f.isCallExpression(statement.expression)
      ? statement.expression : null;
    const callee = call?.callee;
    if (call && f.isMemberExpression(callee) && f.isIdentifier(callee.object) &&
        shapes.has(callee.object.name) && f.isIdentifier(callee.property)) {
      const parent = shapes.get(callee.object.name)!;
      if (callee.property.name === 'appendChild' && call.arguments.length === 1 &&
          f.isIdentifier(call.arguments[0]) && shapes.has(call.arguments[0].name)) {
        const child = call.arguments[0].name;
        if (linked.has(child) || parent.tag === null || child === root) return null;
        linked.add(child);
        parent.children.push(child);
        continue;
      }
      if (callee.property.name === 'setAttribute' && call.arguments.length === 2 &&
          f.isStringLiteral(call.arguments[0]) && f.isStringLiteral(call.arguments[1])) {
        const name = call.arguments[0].value.toLowerCase();
        if (parent.tag === null || !/^[a-z][a-z0-9:_-]*$/.test(name) ||
            name === 'class' || name === 'style' || name.startsWith('on') ||
            parent.attributes.some(([existing]) => existing === name)) return null;
        parent.attributes.push([name, call.arguments[1].value]);
        continue;
      }
    }
    creation.push(cloneNode(statement));
  }
  const seen = new Set<string>();
  function connected(name: string): boolean {
    if (seen.has(name)) return false;
    seen.add(name);
    return shapes.get(name)!.children.every(connected);
  }
  if (!connected(root) || seen.size !== shapes.size) return null;
  const writer = generatedIdentifier(ctx, 'htmlWriter');
  const classes = new Map<string, string>();
  const helper = (name: string, argument: t.Expression) => f.callExpression(
    f.memberExpression(cloneNode(writer), f.identifier(name)), [argument]);
  const classBinding = (name: string): string => {
    let binding = classes.get(name);
    if (!binding) { binding = generatedIdentifier(ctx, 'htmlClass').name; classes.set(name, binding); }
    return binding;
  };

  return (update, result) => {
    if (scope.mounts.length || scope.disposableRegions.length ||
        scope.disposableEntities.length || scope.disposableCallbacks.length) return null;
    let valid = true;
    // A node identifier may only occur in a recognized write. Reading DOM,
    // event/ref work, spread patches, and property writes reject the proof.
    function rewrite(node: t.Node): t.Node {
      if (f.isCallExpression(node) && f.isMemberExpression(node.callee) &&
          f.isIdentifier(node.callee.object) &&
          f.isIdentifier(node.callee.property) && node.arguments.length === 2 &&
          f.isIdentifier(node.arguments[0]) && f.isExpression(node.arguments[1])) {
        const name = node.arguments[0].name;
        const shape = shapes.get(name);
        const method = node.callee.property.name;
        const runtime = md(ctx, method).object as t.Identifier;
        if (shape && f.isIdentifier(node.callee.object, { name: runtime.name })) {
          const value = rewrite(node.arguments[1]) as t.Expression;
          if (method === 'setTextData' && shape.tag === null) {
            return f.assignmentExpression('=', f.identifier(name), value);
          }
          if (method === 'setClassValue' && shape.tag !== null) {
            return f.assignmentExpression('=', f.identifier(classBinding(name)),
              f.callExpression(md(ctx, 'classValue'), [value]));
          }
        }
      }
      if (f.isAssignmentExpression(node) && node.operator === '=' &&
          f.isMemberExpression(node.left) && f.isIdentifier(node.left.object) &&
          f.isIdentifier(node.left.property, { name: 'data' }) &&
          shapes.get(node.left.object.name)?.tag === null) {
        return f.assignmentExpression('=', cloneNode(node.left.object), rewrite(node.right) as t.Expression);
      }
      if (f.isIdentifier(node) && shapes.has(node.name)) valid = false;
      const record = node as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(record)) {
        if (key === 'loc') continue;
        if (Array.isArray(value)) record[key] = value.map(child => isNode(child) ? rewrite(child) : child);
        else if (isNode(value)) record[key] = rewrite(value);
      }
      return node;
    }
    // Text declarations are intentional snapshot bindings, not DOM escapes.
    const statements = creation.map(statement => f.isVariableDeclaration(statement)
      ? cloneNode(statement) : rewrite(cloneNode(statement)) as t.Statement);
    const updated = rewrite(cloneNode(update)) as t.Statement;
    if (!valid) return null;
    function output(name: string): t.Expression {
      const shape = shapes.get(name)!;
      if (shape.tag === null) return helper('text', f.identifier(name));
      const parts: t.Expression[] = [f.stringLiteral('<' + shape.tag)];
      const className = classes.get(name);
      if (className) parts.push(helper('classAttribute', f.identifier(className)));
      parts.push(f.stringLiteral(shape.attributes.map(([key, value]) =>
        value === '' ? ' ' + key : ' ' + key + '="' + escape(value, true) + '"').join('') + '>'));
      parts.push(...shape.children.map(output), f.stringLiteral('</' + shape.tag + '>'));
      // Fold adjacent static pieces so the emitted writer is a small string
      // expression, with no runtime template interpreter or segment arrays.
      const folded: t.Expression[] = [];
      for (const part of parts) {
        const previous = folded.at(-1);
        if (f.isStringLiteral(previous) && f.isStringLiteral(part)) folded[folded.length - 1] = f.stringLiteral(previous.value + part.value);
        else folded.push(part);
      }
      return folded.reduce((left, right) => f.binaryExpression('+', left, right));
    }
    return f.blockStatement([
      f.variableDeclaration('const', [f.variableDeclarator(cloneNode(writer),
        f.memberExpression(f.identifier(scope.documentVar!), f.identifier('htmlWriter')))]),
      f.ifStatement(f.binaryExpression('!==', cloneNode(writer), f.unaryExpression('void', f.numericLiteral(0))),
        f.blockStatement([
          ...[...classes.values()].map(name => f.variableDeclaration('let', [
            f.variableDeclarator(f.identifier(name), f.stringLiteral('')),
          ])),
          updated,
          ...statements,
          f.variableDeclaration('const', [f.variableDeclarator(f.identifier(root),
            helper('create', f.arrowFunctionExpression([], output(root))))]),
          cloneNode(result),
        ])),
    ]);
  };
}

function isNode(value: unknown): value is t.Node {
  return value !== null && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string';
}
