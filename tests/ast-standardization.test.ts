import { describe, expect, it } from 'vitest';
import {
  analyzeScope,
  arrayExpression,
  arrowFunctionExpression,
  binaryExpression,
  blockStatement,
  callExpression,
  collectNodes,
  exportNamedDeclaration,
  exportSpecifier,
  findNode,
  functionDeclaration,
  identifier,
  ifStatement,
  importDeclaration,
  importSpecifier,
  isCallExpression,
  isIdentifier,
  isJSXElement,
  isLiteral,
  isNumericLiteral,
  isStringLiteral,
  isValidIdentifier,
  isVariableDeclarator,
  jsxAttribute,
  jsxClosingElement,
  jsxElement,
  jsxIdentifier,
  jsxOpeningElement,
  jsxText,
  literal,
  memberExpression,
  nullLiteral,
  numericLiteral,
  objectExpression,
  objectProperty,
  program,
  returnStatement,
  stringLiteral,
  toIdentifier,
  transformAst,
  variableDeclaration,
  variableDeclarator,
  walkAst,
} from '../packages/compiler/src/ast';

describe('ESTree AST Standardization Foundation', () => {
  describe('AST Builders & Predicates', () => {
    it('creates standard identifiers, literals, and checks predicates', () => {
      const id = identifier('foo');
      expect(id).toEqual({ type: 'Identifier', name: 'foo' });
      expect(isIdentifier(id)).toBe(true);

      const litStr = stringLiteral('hello');
      expect(litStr.value).toBe('hello');
      expect(isLiteral(litStr)).toBe(true);
      expect(isStringLiteral(litStr)).toBe(true);
      expect(isNumericLiteral(litStr)).toBe(false);

      const litNum = numericLiteral(42);
      expect(litNum.value).toBe(42);
      expect(isNumericLiteral(litNum)).toBe(true);

      const litNull = nullLiteral();
      expect(litNull.value).toBe(null);

      const genLit = literal(true);
      expect(genLit.value).toBe(true);
      expect(genLit.type).toBe('Literal');
    });

    it('normalizes identifier hints without parser utilities', () => {
      expect(toIdentifier('store.items-list')).toBe('storeItemsList');
      expect(toIdentifier('123 value')).toBe('value');
      expect(toIdentifier('class')).toBe('_class');
      expect(toIdentifier('é')).toBe('é');
      expect(isValidIdentifier('renderRow')).toBe(true);
      expect(isValidIdentifier('default')).toBe(false);
      expect(isValidIdentifier('row-value')).toBe(false);
    });

    it('creates expressions, member chains, calls, and object properties', () => {
      const obj = identifier('user');
      const prop = identifier('name');
      const member = memberExpression(obj, prop, false);
      expect(member).toEqual({
        type: 'MemberExpression',
        object: obj,
        property: prop,
        computed: false,
        optional: undefined,
      });

      const call = callExpression(identifier('getUsers'), [stringLiteral('active')]);
      expect(isCallExpression(call)).toBe(true);
      expect(call.arguments).toHaveLength(1);

      const propNode = objectProperty(identifier('age'), numericLiteral(30));
      const objNode = objectExpression([propNode]);
      expect(objNode.properties).toHaveLength(1);

      const arrNode = arrayExpression([numericLiteral(1), numericLiteral(2)]);
      expect(arrNode.elements).toHaveLength(2);
    });

    it('creates JSX elements and fragments according to standard AST specification', () => {
      const tag = jsxIdentifier('div');
      const attr = jsxAttribute(jsxIdentifier('class'), stringLiteral('container'));
      const open = jsxOpeningElement(tag, [attr]);
      const close = jsxClosingElement(tag);
      const text = jsxText('Hello World');
      const el = jsxElement(open, close, [text]);

      expect(isJSXElement(el)).toBe(true);
      expect(el.openingElement.name).toEqual({ type: 'JSXIdentifier', name: 'div' });
      expect(el.children).toHaveLength(1);
    });

    it('creates statements and declarations', () => {
      const decl = variableDeclaration('const', [
        variableDeclarator(identifier('x'), numericLiteral(10)),
      ]);
      expect(decl.kind).toBe('const');
      expect(decl.declarations[0]!.id).toEqual({ type: 'Identifier', name: 'x' });

      const fn = functionDeclaration(
        identifier('add'),
        [identifier('a'), identifier('b')],
        blockStatement([
          returnStatement(binaryExpression('+', identifier('a'), identifier('b'))),
        ]),
      );
      expect(fn.id?.name).toBe('add');
      expect(fn.params).toHaveLength(2);
      expect(fn.body.body).toHaveLength(1);
    });
  });

  describe('AST Walker & Node Searching', () => {
    it('walks full AST tree in pre and post order and supports searching', () => {
      const tree = program([
        variableDeclaration('const', [
          variableDeclarator(
            identifier('msg'),
            callExpression(identifier('format'), [stringLiteral('hi')]),
          ),
          variableDeclarator(
            identifier('later'),
            callExpression(identifier('other'), []),
          ),
        ]),
      ]);

      const visited: string[] = [];
      walkAst(tree, {
        enter(node) {
          visited.push(node.type);
        },
      });

      expect(visited).toContain('Program');
      expect(visited).toContain('VariableDeclaration');
      expect(visited).toContain('CallExpression');
      expect(visited).toContain('Identifier');

      const foundCall = findNode(tree, isCallExpression);
      expect(foundCall).not.toBeNull();
      expect(isIdentifier(foundCall?.callee) ? foundCall.callee.name : null).toBe(
        'format',
      );

      const allIds = collectNodes(tree, isIdentifier);
      expect(allIds.map((n) => n.name)).toEqual([
        'msg',
        'format',
        'later',
        'other',
      ]);
    });
  });

  describe('Lexical Scope Analyzer', () => {
    it('analyzes program and function scopes correctly', () => {
      const tree = program([
        importDeclaration(
          [importSpecifier(identifier('useState'))],
          stringLiteral('framework'),
        ),
        variableDeclaration('const', [
          variableDeclarator(identifier('globalVar'), numericLiteral(100)),
        ]),
        functionDeclaration(
          identifier('Counter'),
          [identifier('props')],
          blockStatement([
            variableDeclaration('let', [
              variableDeclarator(identifier('count'), numericLiteral(0)),
            ]),
            returnStatement(
              binaryExpression(
                '+',
                identifier('globalVar'),
                identifier('count'),
              ),
            ),
          ]),
        ),
      ]);

      const { rootScope } = analyzeScope(tree);
      expect(rootScope.hasOwnBinding('useState')).toBe(true);
      expect(rootScope.hasOwnBinding('globalVar')).toBe(true);
      expect(rootScope.hasOwnBinding('Counter')).toBe(true);
      expect(rootScope.hasOwnBinding('count')).toBe(false);

      const fnScope = rootScope.children[0]!;
      expect(fnScope.hasOwnBinding('props')).toBe(true);
      expect(fnScope.hasOwnBinding('count')).toBe(true);
      expect(fnScope.getBinding('globalVar')).toBeDefined();
      expect(fnScope.getBinding('globalVar')?.references).toHaveLength(1);
      expect(fnScope.getBinding('count')?.references).toHaveLength(1);
    });
  });

  describe('Pure AST Transformer', () => {
    it('transforms AST nodes purely without in-place mutation dependencies', () => {
      const tree = program([
        variableDeclaration('const', [
          variableDeclarator(identifier('a'), numericLiteral(1)),
          variableDeclarator(identifier('b'), numericLiteral(2)),
        ]),
      ]);

      const transformed = transformAst(tree, {
        enter(node) {
          if (isNumericLiteral(node) && node.value === 1) {
            return numericLiteral(99);
          }
          return undefined;
        },
      });

      const nums = collectNodes(transformed!, isNumericLiteral);
      expect(nums.map((n) => n.value)).toEqual([99, 2]);
      expect(collectNodes(tree, isNumericLiteral).map((n) => n.value)).toEqual([1, 2]);
    });

    it('supports node removal by returning null', () => {
      const tree = program([
        variableDeclaration('const', [
          variableDeclarator(identifier('removeMe'), numericLiteral(1)),
          variableDeclarator(identifier('keepMe'), numericLiteral(2)),
        ]),
      ]);

      const transformed = transformAst(tree, {
        enter(node) {
          if (
            isVariableDeclarator(node) &&
            isIdentifier(node.id) &&
            node.id.name === 'removeMe'
          ) {
            return null;
          }
          return undefined;
        },
      });

      const ids = collectNodes(transformed!, isIdentifier);
      expect(ids.map((i) => i.name)).toEqual(['keepMe']);
    });
  });
});
