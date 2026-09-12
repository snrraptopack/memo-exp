import { cloneNode } from '../builders';
import {
  FUNCTION_NODE_TYPES as FUNCTION_NODES,
  isNode,
  nodeFields as fields,
} from '../access';
import { analyzeScope, extractPatternIdentifiers, type Scope } from '../scope';
import { ESTREE_VISITOR_KEYS, walkAst } from '../walk';
import type { BaseNode } from '../types';
import type {
  JSXCodeBlock,
  JSXForExpression,
  JSXIfExpression,
  JSXSwitchExpression,
  JSXTryExpression,
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

function dynamicTagDeclaration(name: string, init: BaseNode): BaseNode {
  return {
    type: 'VariableDeclaration',
    kind: 'const',
    declarations: [{
      type: 'VariableDeclarator',
      id: { type: 'Identifier', name },
      init,
    }],
  } as BaseNode;
}

function collectIdentifierNames(root: BaseNode): Set<string> {
  const names = new Set<string>();
  const seen = new WeakSet<object>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const record = value as Record<string, unknown>;
    if (record.type === 'Identifier' && typeof record.name === 'string') {
      names.add(record.name);
    }
    for (const [key, child] of Object.entries(record)) {
      if (key !== 'loc' && key !== 'metadata') visit(child);
    }
  };
  visit(root);
  return names;
}

/**
 * Turn TSRX expression tag names into ordinary finite-candidate JSX selectors.
 * The declaration remains inside the owning component factory, so the normal
 * compiler dynamic-tag pass owns reactivity, linked components, and errors.
 */
function prepareDynamicTags(program: BaseNode): void {
  const names = collectIdentifierNames(program);
  let counter = 0;
  const freshName = (): string => {
    let name: string;
    do {
      name = `TsrxDynamic${counter++}`;
    } while (names.has(name));
    names.add(name);
    return name;
  };
  const seen = new WeakSet<object>();

  const rewriteTemplate = (
    node: BaseNode,
    declarations: BaseNode[],
    root: BaseNode,
  ): void => {
    if (node !== root && FUNCTION_NODES.has(node.type)) return;
    if (node.type === 'JSXElement') {
      const element = fields(node);
      const opening = element.openingElement;
      if (isNode(opening)) {
        const openingFields = fields(opening);
        const originalName = openingFields.name;
        if (isNode(originalName) && originalName.type === 'JSXExpressionContainer') {
          const expression = fields(originalName).expression;
          if (!isNode(expression) || expression.type === 'JSXEmptyExpression') {
            fail(originalName, 'dynamic tag requires an expression');
          }
          const selector = freshName();
          declarations.push(dynamicTagDeclaration(selector, cloneNode(expression)));
          openingFields.name = { type: 'JSXIdentifier', name: selector };
          delete openingFields.isDynamic;
          const closing = element.closingElement;
          if (isNode(closing)) {
            fields(closing).name = { type: 'JSXIdentifier', name: selector };
            delete fields(closing).isDynamic;
          }
          delete element.isDynamic;
        }
      }
    }

    const keys = ESTREE_VISITOR_KEYS[node.type] ?? Object.keys(node);
    for (const key of keys) {
      if (key === 'loc' || key === 'metadata') continue;
      const value = fields(node)[key];
      if (Array.isArray(value)) {
        for (const child of value) {
          if (isNode(child)) rewriteTemplate(child, declarations, root);
        }
      } else if (isNode(value)) {
        rewriteTemplate(value, declarations, root);
      }
    }
  };

  const visit = (node: BaseNode): void => {
    if (seen.has(node)) return;
    seen.add(node);
    if (FUNCTION_NODES.has(node.type)) {
      const body = fields(node).body;
      if (isNode(body) && body.type === 'JSXCodeBlock') {
        const codeBlock = body as JSXCodeBlock;
        if (codeBlock.render !== null) {
          const declarations: BaseNode[] = [];
          rewriteTemplate(codeBlock.render, declarations, codeBlock.render);
          codeBlock.body.push(...declarations);
        }
      }
    }
    const keys = ESTREE_VISITOR_KEYS[node.type] ?? Object.keys(node);
    for (const key of keys) {
      if (key === 'loc' || key === 'metadata') continue;
      const value = fields(node)[key];
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) visit(child);
      } else if (isNode(value)) {
        visit(value);
      }
    }
  };
  visit(program);
}

function lazyBindingIdentifiers(program: BaseNode): Set<BaseNode> {
  const identifiers = new Set<BaseNode>();
  walkAst(program, {
    enter(node) {
      if (
        (node.type !== 'ObjectPattern' && node.type !== 'ArrayPattern') ||
        fields(node).lazy !== true
      ) {
        return;
      }
      for (const identifier of extractPatternIdentifiers(node)) {
        identifiers.add(identifier);
      }
    },
  });
  return identifiers;
}

function visitScopes(scope: Scope, visit: (scope: Scope) => void): void {
  visit(scope);
  for (const child of scope.children) visitScopes(child, visit);
}

function prepareLazyPatterns(program: BaseNode): void {
  const identifiers = lazyBindingIdentifiers(program);
  if (identifiers.size > 0) {
    const analysis = analyzeScope(program);
    visitScopes(analysis.rootScope, (scope) => {
      for (const binding of scope.bindings.values()) {
        if (!identifiers.has(binding.identifier)) continue;
        const violation = binding.constantViolations[0];
        if (violation !== undefined) {
          fail(
            violation,
            `lazy binding '${binding.name}' cannot be assigned directly; write the source property instead`,
          );
        }
      }
    });
  }
  walkAst(program, {
    enter(node) {
      if (
        (node.type === 'ObjectPattern' || node.type === 'ArrayPattern') &&
        fields(node).lazy === true
      ) {
        delete fields(node).lazy;
      }
    },
  });
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
  const output = lowerTemplateSequence(template);
  return setup.length === 0
    ? output
    : inlineRenderCall(
        blockStatement([
          ...setup.map((statement) => lowerNode(statement)),
          returnStatement(output),
        ]),
      );
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
    return expressionContainer(
      lowerSwitchExpression(node as JSXSwitchExpression),
    );
  }
  if (node.type === 'JSXCodeBlock') {
    return expressionContainer(
      lowerCodeBlockExpression(node as JSXCodeBlock),
    );
  }
  if (node.type === 'JSXTryExpression') {
    return lowerTryExpression(node as JSXTryExpression);
  }
  return lowerNode(node);
}

function returningBlock(block: BaseNode): BaseNode {
  return blockStatement([
    returnStatement(lowerTemplateBlockExpression(block)),
  ]);
}

interface LoweredTsrxCatch {
  param: BaseNode | null;
  resetParam: BaseNode | null;
  output: BaseNode;
}

interface LoweredTsrxTry {
  pending: BaseNode | null;
  handler: LoweredTsrxCatch | null;
}

function lowerTryExpression(node: JSXTryExpression): BaseNode {
  const output = lowerTemplateBlockExpression(node.block);
  const marker = fragment([
    output.type === 'JSXElement' || output.type === 'JSXFragment'
      ? output
      : expressionContainer(output),
  ]);
  const handler = node.handler;
  const handlerFields = handler === null ? null : fields(handler);
  const metadata: LoweredTsrxTry = {
    pending: node.pending === null || node.pending === undefined
      ? null
      : lowerTemplateBlockExpression(node.pending),
    handler: handler === null
      ? null
      : {
          param: isNode(handlerFields?.param) ? cloneNode(handlerFields.param) : null,
          resetParam: isNode(handlerFields?.resetParam)
            ? cloneNode(handlerFields.resetParam)
            : null,
          output: lowerTemplateBlockExpression(
            isNode(handlerFields?.body) ? handlerFields.body : handler,
          ),
        },
  };
  fields(marker).__memoDomTsrxTry = metadata;
  return marker;
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

/**
 * Preserve a nested statement container as an inline JSX render function.
 * The shared compiler pass expands this call and applies the same pure-setup
 * rules used by an equivalent TSX IIFE.
 */
function inlineRenderCall(body: BaseNode): BaseNode {
  return {
    type: 'CallExpression',
    callee: {
      type: 'ArrowFunctionExpression',
      params: [],
      body,
      generator: false,
      async: false,
      expression: false,
    },
    arguments: [],
    optional: false,
  } as BaseNode;
}

function lowerSwitchExpression(node: JSXSwitchExpression): BaseNode {
  return inlineRenderCall(
    blockStatement([lowerRootSwitch(node)]),
  );
}

function lowerCodeBlockExpression(node: JSXCodeBlock): BaseNode {
  return inlineRenderCall(lowerFunctionCodeBlock(node));
}

function lowerNode(node: BaseNode): BaseNode {
  if (node.type === 'JSXStyleElement') {
    return literal(null);
  }
  if (node.type === 'JSXTryExpression') {
    return lowerTryExpression(node as JSXTryExpression);
  }
  if (node.type === 'JSXCodeBlock') {
    return lowerCodeBlockExpression(node as JSXCodeBlock);
  }
  if (node.type === 'TSModuleDeclaration') {
    fail(node, 'module declarations require a future client/server graph contract');
  }
  if (node.type === 'JSXOpeningElement') {
    const name = fields(node).name;
    if (isNode(name) && name.type === 'JSXExpressionContainer') {
      fail(name, 'dynamic tag escaped its owning function lowering');
    }
  }
  if (node.type === 'JSXIfExpression') {
    return lowerIfExpression(node as JSXIfExpression);
  }
  if (node.type === 'JSXForExpression') {
    return lowerForExpression(node as JSXForExpression);
  }
  if (node.type === 'JSXSwitchExpression') {
    return lowerSwitchExpression(node as JSXSwitchExpression);
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
  const output = cloneNode(program);
  prepareLazyPatterns(output);
  prepareDynamicTags(output);
  return lowerNode(output);
}
