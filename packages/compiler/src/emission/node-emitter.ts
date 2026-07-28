import type { NodePath } from '@babel/traverse';
import type * as t from '@babel/types';
import type { Ctx, RowCtx } from '../context';
import type { JsxNode } from '../jsx/children';
import type { EmitScope } from './scope';

/** Shared callback shape used by structural-region emitters. */
export type NodeEmitter = (
  ctx: Ctx,
  scope: EmitScope,
  node: JsxNode,
  componentName: string,
  componentPath: NodePath<t.FunctionDeclaration>,
  nestedIn?: 'row' | 'cond' | null,
  rowContext?: RowCtx,
  eventOriginId?: t.Expression,
  inSvg?: boolean,
  ownerId?: t.Expression,
) => string;
