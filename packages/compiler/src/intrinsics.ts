/** Binding-aware authoring intrinsics. Only the framework's named catalog is implicit. */
import {
  childNode,
  identifierName,
  isReferenceIdentifier,
  walkAst,
  type BaseNode,
} from './ast';
import { astBindingAt, type ProgramPath } from './context';
import { type Ctx } from './context';

const providers: Readonly<Record<string, string>> = {
  $fetch: '@memoized-dom/data',
  $read: '@memoized-dom/data',
  $track: '@memoized-dom/data',
  $forms: '@memoized-dom/data',
  $routed: '@memoized-dom/router',
};

export interface IntrinsicImport {readonly module:string;readonly names:readonly string[];}

/** Generated imports keep request isolation and the existing lowering pipeline. */
export function planCompilerIntrinsics(
  ctx: Ctx,
  program: ProgramPath,
):readonly IntrinsicImport[] {
  const needed = new Map<string, string[]>();
  walkAst(program.node as BaseNode, {
    enter(node, parent, key) {
      if (node.type !== 'Identifier' || !isReferenceIdentifier(parent, key))
        return;
      const name = identifierName(node);
      if ((name === 'effect' || name === 'cleanup') && astBindingAt(ctx, node, name) === undefined) {
        throw program.buildCodeFrameError(
          `memo-dom: use $${name}() for the compiler lifecycle intrinsic; unprefixed ${name} is not supported`, node,
        );
      }
      if (
        (name === '$effect' || name === '$cleanup') &&
        astBindingAt(ctx, node, name) === undefined &&
        (parent?.type !== 'CallExpression' || key !== 'callee')
      ) {
        throw program.buildCodeFrameError(
          `memo-dom: ${name} is a compiler-owned direct call, not a runtime value`,
          node,
        );
      }
      if (
        name === null ||
        !Object.hasOwn(providers, name) ||
        astBindingAt(ctx, node, name) !== undefined
      )
        return;
      const module = providers[name]!;
      const names = needed.get(module) ?? [];
      if (!names.includes(name)) names.push(name);
      needed.set(module, names);
    },
  });
  return [...needed].map(([module,names])=>({module,names:[...names].sort()}));
}

/** Only prefixed lifecycle intrinsics are implicit; shadows are ordinary JS. */
export function isIntrinsicLifecycleCall(
  ctx: Ctx,
  call: BaseNode,
  kind: 'effect' | 'cleanup',
): boolean {
  if (ctx.compilerLifecycleCalls.get(call) === kind) return true;
  const name = identifierName(childNode(call, 'callee'));
  return (
    (call.type === 'CallExpression' ||
      call.type === 'OptionalCallExpression') &&
    name === `$${kind}` &&
    astBindingAt(ctx, call, name) === undefined
  );
}
