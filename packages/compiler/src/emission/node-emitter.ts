import type * as t from '../ast/compiler-types';
import type { Ctx, RowCtx } from '../context';
import type { JsxNode } from '../jsx/children';
import type { EmitScope } from './scope';

type ComponentPath = Ctx['compPaths'] extends Map<string, infer TPath>
  ? TPath
  : never;

/** Shared callback shape used by structural-region emitters. */
export type NodeEmitter = (
  ctx: Ctx,
  scope: EmitScope,
  node: JsxNode,
  componentName: string,
  componentPath: ComponentPath,
  nestedIn?: 'row' | 'cond' | null,
  rowContext?: RowCtx,
  eventOriginId?: t.Expression,
  inSvg?: boolean,
  ownerId?: t.Expression,
) => string;
