/** DOM selector allocation, linked import lowering and JSX replacement. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {analyzeScope,cloneNode as cloneAstNode,isValidIdentifier as isValidEstreeIdentifier,replaceNode,type BaseNode} from '../ast';
import {refreshAstAnalysis,type LinkedComponentImport} from '../context';
import type {DynamicImportBindings} from '../analysis/dynamic-imports';
import type {DynamicTagCandidate,DynamicTagPlan} from '../planning/dynamic-tags';
import type {DomContext as Ctx} from './context';
import {generatedIdentifier} from './identifiers';
function cloneNode<TNode>(value:TNode):TNode {
  return cloneAstNode(value as unknown as BaseNode) as unknown as TNode;
}
/** Install finite linked component candidates before ordinary import analysis. */
export function lowerLinkedDynamicComponentImports(
  ctx: Pick<Ctx,'linkedDynamicComponentCandidates'|'importedComponents'>,
  programPath: {node:t.Program},
): DynamicImportBindings & {readonly imports:readonly t.ImportDeclaration[]} {
  const components=new Map<string,LinkedComponentImport>();
  const owners=new Map<string,readonly string[]>();
  if(ctx.linkedDynamicComponentCandidates.size===0)return {components,owners,imports:[]};
  const program = programPath.node as unknown as BaseNode;
  const occupied = new Set(analyzeScope(program).rootScope.bindings.keys());
  const existingByKey = new Map(
    [...ctx.importedComponents].map(([local, component]) => [
      component.key,
      local,
    ]),
  );
  const declarations: t.ImportDeclaration[] = [];

  for (const [owner, candidates] of ctx.linkedDynamicComponentCandidates) {
    const locals: string[] = [];
    for (const candidate of candidates) {
      let local = existingByKey.get(candidate.key);
      if (local === undefined) {
        const base = `MDDynamic_${candidate.imported.replace(
          /[^A-Za-z0-9_$]/g,
          '_',
        )}`;
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
    owners.set(owner,Object.freeze(unique));
  }
  return {components,owners,imports:declarations};
}

function cloneWithTag(
  element: t.JSXElement,
  tag: t.JSXIdentifier,
): t.JSXElement {
  const clone = cloneNode(element);
  clone.openingElement.name = cloneNode(tag);
  if (clone.closingElement != null) clone.closingElement.name = cloneNode(tag);
  return clone;
}

function finiteSelection(
  ctx: Ctx,
  selector: t.Expression,
  element: t.JSXElement,
  candidates: readonly DynamicTagCandidate[],
): t.Expression {
  // The selection becomes a cond-region pick that re-evaluates on every
  // update. Evaluate the selector once per pick through a shared scratch
  // binding instead of re-running it inside every candidate comparison.
  const scratch =
    ctx.emission.dynamicTagSelector ??
    (ctx.emission.dynamicTagSelector = generatedIdentifier(
      ctx,
      'dynamicTagSelector',
    ).name);
  if (ctx.emission.header.every((node) => !isDynamicTagScratchDecl(node, scratch))) {
    ctx.emission.header.push(
      astFactory.variableDeclaration('let', [
        astFactory.variableDeclarator(astFactory.identifier(scratch)),
      ]),
    );
  }
  let selection: t.Expression = astFactory.nullLiteral();
  for (let index = candidates.length - 1; index >= 0; index--) {
    const candidate = candidates[index]!;
    const selected = astFactory.identifier(scratch);
    selection = astFactory.conditionalExpression(
      astFactory.binaryExpression(
        '===',
        index === 0
          ? astFactory.assignmentExpression(
              '=',
              selected,
              cloneNode(selector),
            )
          : selected,
        cloneNode(candidate.compare),
      ),
      cloneWithTag(element, astFactory.jsxIdentifier(candidate.name)),
      selection,
    );
  }
  return selection;
}

function isDynamicTagScratchDecl(node: t.Statement, name: string): boolean {
  return (
    astFactory.isVariableDeclaration(node) &&
    node.declarations.some(
      (declaration) =>
        astFactory.isIdentifier(declaration.id) &&
        declaration.id.name === name,
    )
  );
}

/** Apply captured sites without rediscovering candidates or changing prop facts. */
export function lowerDynamicTags(ctx:Ctx,plan:DynamicTagPlan):void {
  const program=ctx.astAnalysis!.rootScope.block;
  for(const {path,hasJsx,sites} of plan.components) {
    for(const site of sites) {
      if(site.kind==='namespace')throw path.buildCodeFrameError('memo-dom: namespaced JSX tags are not supported');
      const {element,selector,candidates}=site;
      for(const candidate of candidates) {
        if(candidate.kind==='intrinsic' && !/^[A-Za-z][A-Za-z0-9:_-]*$/.test(candidate.name)) {
          throw path.buildCodeFrameError(`memo-dom: '${candidate.name}' is not a valid dynamic intrinsic tag name`);
        }
      }
      const replacement=candidates.length===1
        ? cloneWithTag(element,astFactory.jsxIdentifier(candidates[0]!.name))
        : astFactory.jsxFragment(astFactory.jsxOpeningFragment(),astFactory.jsxClosingFragment(),[
          astFactory.jsxExpressionContainer(finiteSelection(ctx,selector,element,candidates)),
        ]);
      replaceNode(ctx.astAnalysis!,element as unknown as BaseNode,replacement as unknown as BaseNode);
    }
    if(hasJsx)refreshAstAnalysis(ctx,program);
  }
}
