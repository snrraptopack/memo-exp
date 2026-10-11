/** Allocate ordinary imports for finite linked component identities. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import { analyzeScope, isValidIdentifier as isValidEstreeIdentifier, type BaseNode } from '../ast';
import type { Ctx, LinkedComponentImport } from '../context';
import type { DynamicImportBindings } from '../analysis/dynamic-imports';
/** Install finite linked component candidates before ordinary import analysis. */
export function lowerLinkedDynamicComponentImports(
  ctx: Pick<Ctx, 'linkedDynamicComponentCandidates' | 'importedComponents'>,
  programPath: { node: t.Program },
): DynamicImportBindings & { readonly imports: readonly t.ImportDeclaration[] } {
  const components = new Map<string, LinkedComponentImport>();
  const owners = new Map<string, readonly string[]>();
  if (ctx.linkedDynamicComponentCandidates.size === 0) return { components, owners, imports: [] };
  const program = programPath.node as unknown as BaseNode;
  const occupied = new Set(analyzeScope(program).rootScope.bindings.keys());
  const existingByKey = new Map(
    [...ctx.importedComponents].map(([local, component]) => [component.key, local]),
  );
  const declarations: t.ImportDeclaration[] = [];

  for (const [owner, candidates] of ctx.linkedDynamicComponentCandidates) {
    const locals: string[] = [];
    for (const candidate of candidates) {
      let local = existingByKey.get(candidate.key);
      if (local === undefined) {
        const base = `MDDynamic_${candidate.imported.replace(/[^A-Za-z0-9_$]/g, '_')}`;
        local = base;
        let index = 1;
        while (occupied.has(local)) local = `${base}${index++}`;
        occupied.add(local);
        existingByKey.set(candidate.key, local);

        const component = {
          type: 'component' as const,
          key: candidate.key,
          props: [...candidate.props],
          objectProps: candidate.objectProps,
          acceptsUnknownProps: candidate.acceptsUnknownProps,
          hasWholeDefault: candidate.hasWholeDefault,
          listLightweight: candidate.listLightweight,
          delegatedEvents: candidate.delegatedEvents,
          renderProps: [...(candidate.renderProps ?? [])],
          renderCallbacks: [...(candidate.renderCallbacks ?? [])],
          refProps: [...(candidate.refProps ?? [])],
          subtreeReads: [...(candidate.subtreeReads ?? [])],
        };
        components.set(local, component);
        declarations.push(
          astFactory.importDeclaration(
            candidate.imported === 'default'
              ? [astFactory.importDefaultSpecifier(astFactory.identifier(local))]
              : [
                  astFactory.importSpecifier(
                    astFactory.identifier(local),
                    isValidEstreeIdentifier(candidate.imported)
                      ? astFactory.identifier(candidate.imported)
                      : astFactory.stringLiteral(candidate.imported),
                  ),
                ],
            astFactory.stringLiteral(candidate.source),
          ),
        );
      }
      locals.push(local);
    }
    const unique = [...new Set(locals)];
    owners.set(owner, Object.freeze(unique));
  }
  return { components, owners, imports: declarations };
}
