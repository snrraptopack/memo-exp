/** Generated presentation-policy components shared by Group and TSRX. */
import type * as t from '../../ast/compiler-types';
import * as astFactory from '../../ast/factory';
import {
  analyzeScope,
  cloneNode as cloneEstreeNode,
  isReferenceIdentifier,
  walkAst,
  type BaseNode,
  type Binding as AstBinding,
  type Identifier as AstIdentifier,
} from '../../ast';
import {
  astBindingAt,
  type Ctx,
  type TransparentPresentationComponent,
} from '../../context';
import {
  generatedComponentIdentifier,
  generatedIdentifier,
} from '../../identifiers';

export function componentPolicy(
  ctx: Ctx,
  expression: t.Expression | t.JSXEmptyExpression,
  kind: 'pending' | 'error',
  generatedPolicies: t.FunctionDeclaration[],
  errorAt: { buildCodeFrameError(message: string, at?: t.Node): Error },
  boundary: BaseNode,
): string | TransparentPresentationComponent {
  if (astFactory.isIdentifier(expression)) return expression.name;
  if (
    !astFactory.isArrowFunctionExpression(expression) &&
    !astFactory.isFunctionExpression(expression)
  ) {
    throw errorAt.buildCodeFrameError(
      `memo-dom: Group ${kind} must be a component identifier or inline render callback`,
      expression,
    );
  }
  if (expression.async || expression.generator) {
    throw errorAt.buildCodeFrameError(
      `memo-dom: Group ${kind} render callbacks must be synchronous`,
      expression,
    );
  }
  if (expression.params.length > 1) {
    throw errorAt.buildCodeFrameError(
      `memo-dom: Group ${kind} render callbacks accept at most one props parameter`,
      expression,
    );
  }
  const parameter = expression.params[0];
  if (kind === 'pending' && parameter !== undefined) {
    throw errorAt.buildCodeFrameError(
      'memo-dom: Group pending render callbacks do not receive props',
      parameter,
    );
  }
  if (
    kind === 'error' &&
    parameter !== undefined &&
    !astFactory.isObjectPattern(parameter)
  ) {
    throw errorAt.buildCodeFrameError(
      'memo-dom: Group error render callbacks receive one destructured { error, retry } props object',
      parameter,
    );
  }
  const captures = policyCaptures(
    ctx,
    boundary,
    expression as unknown as BaseNode,
    new Set(),
  );
  const props: Array<{ prop: string; local: t.Identifier }> = [];
  if (kind === 'error') {
    const policyLocal = (name: 'error' | 'retry'): t.Identifier => {
      if (astFactory.isObjectPattern(parameter)) {
        for (const property of parameter.properties) {
          if (
            astFactory.isObjectProperty(property) &&
            !property.computed &&
            astFactory.isIdentifier(property.key, { name }) &&
            astFactory.isIdentifier(property.value)
          ) {
            return cloneEstreeNode(property.value);
          }
        }
      }
      return generatedIdentifier(ctx, name === 'error' ? 'groupError' : 'groupRetry');
    };
    const error = policyLocal('error');
    const retry = policyLocal('retry');
    props.push({ prop: 'error', local: error });
    props.push({ prop: 'retry', local: retry });
  }
  for (const capture of captures) {
    props.push({
      prop: capture.prop,
      local: astFactory.identifier(capture.binding.name),
    });
  }
  const component = generatedComponentIdentifier(
    ctx,
    kind === 'pending' ? 'GroupPending' : 'GroupError',
  );
  const callbackBody: t.Statement[] = [];
  if (astFactory.isBlockStatement(expression.body)) {
    callbackBody.push(
      ...expression.body.body.map((statement) => cloneEstreeNode(statement, true)),
    );
  } else {
    callbackBody.push(
      astFactory.returnStatement(cloneEstreeNode(expression.body, true)),
    );
  }
  generatedPolicies.push(
    astFactory.functionDeclaration(
      cloneEstreeNode(component),
      props.length === 0 ? [] : [objectBindingPattern(props)],
      astFactory.blockStatement(callbackBody),
    ),
  );
  return {
    component: component.name,
    props: captures.map((capture) => ({
      name: capture.prop,
      value: astFactory.identifier(capture.binding.name),
    })),
  };
}

interface PolicyCapture {
  binding: AstBinding;
  prop: string;
}

export function policyCaptures(
  ctx: Ctx,
  boundary: BaseNode,
  output: BaseNode,
  excluded: ReadonlySet<string>,
): PolicyCapture[] {
  const local = analyzeScope(output);
  const captures = new Map<AstBinding, PolicyCapture>();
  walkAst(output, {
    enter(node) {
      if (node.type !== 'Identifier') return;
      const identifier = node as unknown as AstIdentifier;
      const parent = local.parentByNode.get(node) ?? null;
      const key = local.keyByNode.get(node);
      if (!isReferenceIdentifier(parent, key)) return;
      if (local.nodeToScope.get(node)?.getBinding(identifier.name) !== undefined) {
        return;
      }
      if (excluded.has(identifier.name)) return;
      const binding = astBindingAt(ctx, boundary, identifier.name);
      if (
        binding === undefined ||
        binding.scope.isProgramScope ||
        captures.has(binding)
      ) {
        return;
      }
      captures.set(binding, {
        binding,
        prop: `capture${captures.size}`,
      });
    },
  });
  return [...captures.values()];
}

export function objectBindingPattern(
  entries: ReadonlyArray<{ prop: string; local: t.Identifier }>,
): t.ObjectPattern {
  return {
    type: 'ObjectPattern',
    properties: entries.map(({ prop, local }) =>
      astFactory.objectProperty(
        astFactory.identifier(prop),
        cloneEstreeNode(local),
        false,
        prop === local.name,
      )
    ),
  } as unknown as t.ObjectPattern;
}
