/** Binding-aware authoring intrinsics. Only the framework's named catalog is implicit. */
import * as astFactory from './ast/factory';
import {
  childNode,
  identifierName,
  isReferenceIdentifier,
  walkAst,
  type BaseNode,
} from './ast';
import {
  astBindingAt,
  refreshAstAnalysis,
  type Ctx,
  type ProgramPath,
} from './context';

const providers: Readonly<Record<string, string>> = {
  $fetch: '@memoized-dom/data',
  $read: '@memoized-dom/data',
  $track: '@memoized-dom/data',
  $forms: '@memoized-dom/data',
  $routed: '@memoized-dom/router',
};

/** Generated imports keep request isolation and the existing lowering pipeline. */
export function installCompilerIntrinsics(
  ctx: Ctx,
  program: ProgramPath,
): void {
  refreshAstAnalysis(ctx, program.node);
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
      if (name === '$routed') ctx.importedValues.add(name);
      const names = needed.get(module) ?? [];
      if (!names.includes(name)) names.push(name);
      needed.set(module, names);
    },
  });
  for (const [module, names] of needed) {
    program.node.body.unshift(
      astFactory.importDeclaration(
        names
          .sort()
          .map((name) =>
            astFactory.importSpecifier(
              astFactory.identifier(name),
              astFactory.identifier(name),
            ),
          ),
        astFactory.stringLiteral(module),
      ),
    );
  }
  if (needed.size > 0) refreshAstAnalysis(ctx, program.node);
}

/** Only prefixed lifecycle intrinsics are implicit; shadows are ordinary JS. */
export function isIntrinsicLifecycleCall(
  ctx: Ctx,
  call: BaseNode,
  kind: 'effect' | 'cleanup',
): boolean {
  const name = identifierName(childNode(call, 'callee'));
  return (
    (call.type === 'CallExpression' ||
      call.type === 'OptionalCallExpression') &&
    name === `$${kind}` &&
    astBindingAt(ctx, call, name) === undefined
  );
}
