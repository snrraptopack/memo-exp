import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  analyzeScope,
  overwriteNode,
  walkAst,
  type BaseNode,
  type Scope,
  type ScopeAnalysis,
} from '../ast';
import { compilerError } from '../errors';

export type FunctionNode =
  | t.ArrowFunctionExpression
  | t.FunctionExpression
  | t.FunctionDeclaration;

export class HandlerPath<TNode extends t.Node = t.Node> {
  public readonly node: TNode;
  public readonly parentPath: HandlerPath | null;
  public shouldSkip = false;

  constructor(
    node: BaseNode,
    private readonly analysis: ScopeAnalysis,
    private readonly moduleId: string,
  ) {
    this.node = node as unknown as TNode;
    const parent = analysis.parentByNode.get(node) ?? null;
    this.parentPath = parent === null
      ? null
      : new HandlerPath(parent, analysis, moduleId);
  }

  public get parent(): t.Node | null {
    return this.parentPath?.node ?? null;
  }

  public get scope(): Scope {
    const scope = this.analysis.nodeToScope.get(
      this.node as unknown as BaseNode,
    );
    if (scope === undefined) {
      throw new TypeError(`Missing handler scope for ${this.node.type}`);
    }
    return scope;
  }

  public getFunctionParent(): HandlerPath<FunctionNode> | null {
    let current = this.parentPath;
    while (current !== null) {
      if (astFactory.isFunction(current.node)) {
        return current as HandlerPath<FunctionNode>;
      }
      current = current.parentPath;
    }
    return null;
  }

  public isExpression(): this is HandlerPath<t.Expression> {
    return astFactory.isExpression(this.node);
  }

  public isVariableDeclarator(): this is HandlerPath<t.VariableDeclarator> {
    return astFactory.isVariableDeclarator(this.node);
  }

  public isVariableDeclaration(): this is HandlerPath<t.VariableDeclaration> {
    return astFactory.isVariableDeclaration(this.node);
  }

  public isAssignmentExpression(
    options?: { operator?: string },
  ): this is HandlerPath<t.AssignmentExpression> {
    return astFactory.isAssignmentExpression(this.node) &&
      (options?.operator === undefined || this.node.operator === options.operator);
  }

  public replaceWith(replacement: t.Node): void {
    overwriteNode(
      this.node as unknown as BaseNode,
      replacement as unknown as BaseNode,
    );
  }

  public skip(): void {
    this.shouldSkip = true;
  }

  public buildCodeFrameError(message: string): Error {
    return compilerError(
      message,
      this.moduleId,
      this.node as unknown as BaseNode,
    );
  }
}

export interface HandlerVisitor {
  VariableDeclarator?(path: HandlerPath<t.VariableDeclarator>): void;
  Function?(path: HandlerPath<FunctionNode>): void;
  AssignmentExpression?(path: HandlerPath<t.AssignmentExpression>): void;
  UpdateExpression?(path: HandlerPath<t.UpdateExpression>): void;
  UnaryExpression?(path: HandlerPath<t.UnaryExpression>): void;
  CallExpression?(path: HandlerPath<t.CallExpression>): void;
}

export function walkHandler(
  root: t.Node,
  visitor: HandlerVisitor,
  moduleId: string,
): ScopeAnalysis {
  const analysis = analyzeScope(root as unknown as BaseNode);
  walkAst(root as unknown as BaseNode, {
    enter(node) {
      const path = new HandlerPath(node, analysis, moduleId);
      if (node.type === 'VariableDeclarator') {
        visitor.VariableDeclarator?.(
          path as HandlerPath<t.VariableDeclarator>,
        );
      }
      if (astFactory.isFunction(node as unknown as t.Node)) {
        visitor.Function?.(path as HandlerPath<FunctionNode>);
      }
      if (node.type === 'AssignmentExpression') {
        visitor.AssignmentExpression?.(
          path as HandlerPath<t.AssignmentExpression>,
        );
      }
      if (node.type === 'UpdateExpression') {
        visitor.UpdateExpression?.(path as HandlerPath<t.UpdateExpression>);
      }
      if (node.type === 'UnaryExpression') {
        visitor.UnaryExpression?.(path as HandlerPath<t.UnaryExpression>);
      }
      if (node.type === 'CallExpression') {
        visitor.CallExpression?.(path as HandlerPath<t.CallExpression>);
      }
      return path.shouldSkip ? false : undefined;
    },
  });
  return analysis;
}
