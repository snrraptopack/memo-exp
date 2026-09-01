import { cloneNode } from '../builders';
import { ESTREE_VISITOR_KEYS } from '../walk';
import type { BaseNode } from '../types';
import type {
  JSXCodeBlock,
  JSXForExpression,
  JSXIfExpression,
  JSXSwitchExpression,
} from './types';

const TEMPLATE_NODES = new Set([
  'JSXElement',
  'JSXFragment',
  'JSXText',
  'JSXExpressionContainer',
  'JSXCodeBlock',
  'JSXIfExpression',
  'JSXForExpression',
  'JSXSwitchExpression',
  'JSXTryExpression',
  'JSXStyleElement',
]);

const TSRX_EXPRESSION_NODES = new Set([
  'JSXCodeBlock',
  'JSXIfExpression',
  'JSXForExpression',
  'JSXSwitchExpression',
  'JSXTryExpression',
]);

function fields(node: BaseNode): Record<string, unknown> {
  return node as unknown as Record<string, unknown>;
}

function isNode(value: unknown): value is BaseNode {
  return value !== null && typeof value === 'object' &&
    typeof (value as { type?: unknown }).type === 'string';
}

function isIfBranchNode(node: BaseNode | null | undefined): node is JSXIfExpression {
  return node !== null && node !== undefined && (
    node.type === 'JSXIfExpression' ||
    node.type === 'IfStatement'
  );
}

export class TsrxLoweringError extends SyntaxError {
  constructor(
    message: string,
    public readonly node: BaseNode,
  ) {
    super(`memo-dom TSRX: ${message}`);
    this.name = 'TsrxLoweringError';
  }
}

function fail(node: BaseNode, message: string): never {
  throw new TsrxLoweringError(message, node);
}

function literal(value: string | number | boolean | null): BaseNode {
  return { type: 'Literal', value, raw: value === null ? 'null' : JSON.stringify(value) } as BaseNode;
}

function returnStatement(argument: BaseNode | null): BaseNode {
  return { type: 'ReturnStatement', argument } as BaseNode;
}

function blockStatement(body: BaseNode[]): BaseNode {
  return { type: 'BlockStatement', body } as BaseNode;
}

function expressionContainer(expression: BaseNode): BaseNode {
  return { type: 'JSXExpressionContainer', expression } as BaseNode;
}

function fragment(children: BaseNode[]): BaseNode {
  return {
    type: 'JSXFragment',
    openingFragment: { type: 'JSXOpeningFragment' },
    closingFragment: { type: 'JSXClosingFragment' },
    children,
  } as BaseNode;
}

function ensureJsxRoot(expression: BaseNode): BaseNode {
  return expression.type === 'JSXElement' || expression.type === 'JSXFragment'
    ? expression
    : fragment([expressionContainer(expression)]);
}

interface TemplateBlockParts {
  setup: BaseNode[];
  template: BaseNode[];
}

function templateBlockParts(block: BaseNode): TemplateBlockParts {
  if (block.type !== 'BlockStatement') {
    fail(block, `expected a template block, received '${block.type}'`);
  }
  const body = fields(block).body;
  if (!Array.isArray(body)) fail(block, 'template block has no body');
  const setup: BaseNode[] = [];
  const template: BaseNode[] = [];
  let rendering = false;
  for (const item of body) {
    if (!isNode(item)) continue;
    if (item.type === 'JSXStyleElement') {
      // Scoped CSS was already extracted and hashed by prepareTsrxStyles
      continue;
    }
    if (TEMPLATE_NODES.has(item.type)) {
      rendering = true;
      template.push(item);
    } else if (rendering) {
      fail(item, 'setup statements must appear before rendered template children');
    } else {
      setup.push(item);
    }
  }
  return { setup, template };
}
function lowerTemplateSequence(nodes: BaseNode[]): BaseNode {
  const children = nodes.map(lowerTemplateChild);
  if (children.length === 0) return literal(null);
  if (children.length === 1) {
    const child = children[0]!;
    return child.type === 'JSXExpressionContainer'
      ? fields(child).expression as BaseNode
      : child;
  }
  return fragment(children);
}

function lowerTemplateBlockExpression(block: BaseNode): BaseNode {
  const { setup, template } = templateBlockParts(block);
  if (setup.length > 0) {
    fail(
      setup[0]!,
      'branch-local setup is not supported by the experimental direct lowering yet',
    );
  }
  return lowerTemplateSequence(template);
}

function lowerIfExpression(node: JSXIfExpression): BaseNode {
  const test = lowerNode(node.test);
  const consequent = lowerTemplateBlockExpression(node.consequent);
  const alternate = node.alternate === null
    ? literal(null)
    : isIfBranchNode(node.alternate)
    ? lowerIfExpression(node.alternate)
    : lowerTemplateBlockExpression(node.alternate);
  return { type: 'ConditionalExpression', test, consequent, alternate } as BaseNode;
}

function forBinding(node: JSXForExpression): BaseNode {
  if (node.statementType !== 'ForOfStatement' || node.right === undefined) {
    fail(node, 'only @for (... of ...) is supported by the experimental lowering');
  }
  const left = node.left;
  if (left === undefined) fail(node, '@for is missing its iteration binding');
  if (left.type !== 'VariableDeclaration') return lowerNode(left);
  const declarations = fields(left).declarations;
  if (!Array.isArray(declarations) || declarations.length !== 1 || !isNode(declarations[0])) {
    fail(left, '@for must declare exactly one iteration binding');
  }
  const id = fields(declarations[0]).id;
  if (!isNode(id)) fail(left, '@for iteration declaration has no binding');
  return lowerNode(id);
}

function addKey(output: BaseNode, key: BaseNode, source: BaseNode): void {
  if (output.type !== 'JSXElement') {
    fail(source, '@for key currently requires one JSX element as the loop output');
  }
  const opening = fields(output).openingElement;
  if (!isNode(opening)) fail(output, 'loop output has no opening JSX element');
  const attributes = fields(opening).attributes;
  if (!Array.isArray(attributes)) fail(opening, 'loop output has no JSX attributes');
  const hasKey = attributes.some((attribute) => {
    if (!isNode(attribute) || attribute.type !== 'JSXAttribute') return false;
    const name = fields(attribute).name;
    return isNode(name) && name.type === 'JSXIdentifier' && fields(name).name === 'key';
  });
  if (!hasKey) {
    attributes.push({
      type: 'JSXAttribute',
      name: { type: 'JSXIdentifier', name: 'key' },
      value: expressionContainer(lowerNode(key)),
    });
  }
}

function lowerForExpression(node: JSXForExpression): BaseNode {
  const binding = forBinding(node);
  const right = lowerNode(node.right!);
  const { setup, template } = templateBlockParts(node.body);
  let output = lowerTemplateSequence(template);
  if (node.key !== null && node.key !== undefined) addKey(output, node.key, node);

  const params = [binding];
  if (node.index !== null && node.index !== undefined) params.push(lowerNode(node.index));
  const callbackBody = setup.length === 0
    ? output
    : blockStatement([
        ...setup.map((statement) => lowerNode(statement)),
        returnStatement(output),
      ]);
  const callback = {
    type: 'ArrowFunctionExpression',
    params,
    body: callbackBody,
    generator: false,
    async: false,
    expression: callbackBody.type !== 'BlockStatement',
  } as BaseNode;
  const mapped = {
    type: 'CallExpression',
    callee: {
      type: 'MemberExpression',
      object: cloneNode(right),
      property: { type: 'Identifier', name: 'map' },
      computed: false,
      optional: false,
    },
    arguments: [callback],
    optional: false,
  } as BaseNode;
  if (node.empty === null || node.empty === undefined) return mapped;

  const empty = lowerTemplateBlockExpression(node.empty);
  return {
    type: 'ConditionalExpression',
    test: {
      type: 'BinaryExpression',
      operator: '>',
      left: {
        type: 'MemberExpression',
        object: cloneNode(right),
        property: { type: 'Identifier', name: 'length' },
        computed: false,
        optional: false,
      },
      right: literal(0),
    },
    consequent: mapped,
    alternate: empty,
  } as BaseNode;
}

function lowerTemplateChild(node: BaseNode): BaseNode {
  if (node.type === 'JSXIfExpression') {
    return expressionContainer(lowerIfExpression(node as JSXIfExpression));
  }
  if (node.type === 'JSXForExpression') {
    return expressionContainer(lowerForExpression(node as JSXForExpression));
  }
  if (node.type === 'JSXSwitchExpression') {
    fail(node, 'nested @switch is not supported yet; use @switch as the component output');
  }
  if (node.type === 'JSXCodeBlock') {
    fail(node, 'nested statement containers are not supported yet');
  }
  return lowerNode(node);
}

function returningBlock(block: BaseNode): BaseNode {
  const { setup, template } = templateBlockParts(block);
  if (setup.length > 0) {
    fail(
      setup[0]!,
      'control-flow branch setup is not supported by the current component return planner',
    );
  }
  return blockStatement([returnStatement(lowerTemplateSequence(template))]);
}

function lowerRootIf(node: JSXIfExpression): BaseNode {
  return {
    type: 'IfStatement',
    test: lowerNode(node.test),
    consequent: returningBlock(node.consequent),
    alternate: node.alternate === null
      ? blockStatement([returnStatement(literal(null))])
      : isIfBranchNode(node.alternate)
      ? lowerRootIf(node.alternate)
      : returningBlock(node.alternate),
  } as BaseNode;
}

function lowerRootSwitch(node: JSXSwitchExpression): BaseNode {
  return {
    type: 'SwitchStatement',
    discriminant: lowerNode(node.discriminant),
    cases: node.cases.map((switchCase) => {
      if (switchCase.type !== 'SwitchCase') fail(switchCase, 'invalid @switch case');
      const consequent = fields(switchCase).consequent;
      if (!Array.isArray(consequent)) fail(switchCase, '@switch case has no body');
      const block = blockStatement(consequent.filter(isNode));
      return {
        type: 'SwitchCase',
        test: isNode(fields(switchCase).test)
          ? lowerNode(fields(switchCase).test as BaseNode)
          : null,
        consequent: fields(returningBlock(block)).body,
      };
    }),
  } as BaseNode;
}

function lowerFunctionCodeBlock(node: JSXCodeBlock): BaseNode {
  const setup = node.body.map((statement) => lowerNode(statement));
  if (node.render === null) fail(node, 'statement container must finish with a render output');
  if (node.render.type === 'JSXIfExpression') {
    return blockStatement([...setup, lowerRootIf(node.render as JSXIfExpression)]);
  }
  if (node.render.type === 'JSXSwitchExpression') {
    return blockStatement([...setup, lowerRootSwitch(node.render as JSXSwitchExpression)]);
  }
  const rendered = node.render.type === 'JSXForExpression'
    ? ensureJsxRoot(lowerForExpression(node.render as JSXForExpression))
    : ensureJsxRoot(lowerNode(node.render));
  return blockStatement([...setup, returnStatement(rendered)]);
}

function lowerNode(node: BaseNode): BaseNode {
  if (node.type === 'JSXStyleElement') {
    return literal(null);
  }
  if (node.type === 'JSXTryExpression') {
    fail(node, '@try/@pending/@catch require Memoized DOM runtime semantics');
  }
  if (node.type === 'TSModuleDeclaration') {
    fail(node, 'module declarations require a future client/server graph contract');
  }
  if (node.type === 'JSXOpeningElement') {
    const name = fields(node).name;
    if (isNode(name) && name.type === 'JSXExpressionContainer') {
      fail(name, 'dynamic <{expression}> tags are not supported yet');
    }
  }
  if (
    (node.type === 'ObjectPattern' || node.type === 'ArrayPattern') &&
    fields(node).lazy === true
  ) {
    fail(node, 'lazy destructuring requires explicit reactive binding semantics');
  }
  if (node.type === 'JSXIfExpression') {
    return lowerIfExpression(node as JSXIfExpression);
  }
  if (node.type === 'JSXForExpression') {
    return lowerForExpression(node as JSXForExpression);
  }
  if (node.type === 'JSXSwitchExpression') {
    fail(node, '@switch is currently supported only as a statement-container function output');
  }

  if (
    (node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression') &&
    isNode(fields(node).body) &&
    (fields(node).body as BaseNode).type === 'JSXCodeBlock'
  ) {
    fields(node).body = lowerFunctionCodeBlock(fields(node).body as JSXCodeBlock);
  }

  const keys = ESTREE_VISITOR_KEYS[node.type] ?? Object.keys(node);
  for (const key of keys) {
    const value = fields(node)[key];
    if (
      key === 'children' &&
      (node.type === 'JSXElement' || node.type === 'JSXFragment') &&
      Array.isArray(value)
    ) {
      const children: BaseNode[] = [];
      for (const child of value) {
        if (!isNode(child)) {
          children.push(child);
          continue;
        }
        if (child.type === 'JSXStyleElement') {
          // Scoped CSS was already extracted and hashed by prepareTsrxStyles
          continue;
        }
        children.push(
          TSRX_EXPRESSION_NODES.has(child.type)
            ? lowerTemplateChild(child)
            : lowerNode(child),
        );
      }
      fields(node)[key] = children;
      continue;
    }
    if (Array.isArray(value)) {
      fields(node)[key] = value.map((item) => isNode(item) ? lowerNode(item) : item);
    } else if (isNode(value)) {
      fields(node)[key] = lowerNode(value);
    }
  }
  return node;
}

/** Lower the supported TSRX extension nodes to compiler-ready TS-ESTree/JSX. */
export function lowerTsrxProgram(program: BaseNode): BaseNode {
  if (program.type !== 'Program') {
    throw new TypeError(`Expected a TSRX Program, received '${program.type}'`);
  }
  return lowerNode(cloneNode(program));
}
