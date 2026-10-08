/** DOM factory prop initialization, replay and runtime reason ABI. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {cloneNode,walkAst,type BaseNode} from '../ast';
import {parameterTarget,isObjectProperty,propertyName,bindingNames,type ComponentPropsPlan,type ComponentParam,type PropTarget} from '../components/props';
function cloneCompilerNode<TNode extends t.Node>(node:TNode):TNode {
 return cloneNode(node as unknown as BaseNode) as unknown as TNode;
}

/** Initial locals for an entity factory whose inputs live in a props box. */
export function buildPropDeclaration(
  plan: ComponentPropsPlan,
  sources: t.Expression[],
): t.VariableDeclaration | null {
  if (plan.params.length === 0) return null;
  return astFactory.variableDeclaration(
    'let',
    plan.params.map((param, index) =>
      astFactory.variableDeclarator(
        assignmentTarget(parameterTarget(param)),
        inputWithDefault(param, sources[index] ?? astFactory.identifier('undefined')),
      ),
    ),
  );
}

/** Replay original parameter semantics from new slot values. */
export function buildPropReplay(
  plan: ComponentPropsPlan,
  sources: t.Expression[],
): t.Statement[] {
  return plan.params.map((param, index) =>
    astFactory.expressionStatement(
      astFactory.assignmentExpression(
        '=',
        assignmentTarget(parameterTarget(param)),
        inputWithDefault(param, sources[index] ?? astFactory.identifier('undefined')),
      ),
    ),
  );
}

/**
 * Extra `registerProps` arguments mapping each declared prop key to the dirty
 * reasons of the bindings it introduces, plus the reason for undeclared keys
 * (object rest / whole `props` binding). Null when the envelope shape gives
 * the runtime nothing exact to attribute, so it falls back to a full update.
 */
export function propReasonArguments(
  plan: ComponentPropsPlan,
  reasonIds: ReadonlyMap<string, number>,
): t.Expression[] | null {
  if (plan.mode !== 'object' || plan.params.length !== 1) return null;
  const target = parameterTarget(plan.params[0]!);
  const reasonsOf = (pattern: t.Node): t.Expression | null => {
    const reasons = bindingNames(pattern as t.LVal).map((name) =>
      reasonIds.get(name),
    );
    if (reasons.some((reason) => reason === undefined)) return null;
    if (reasons.length === 1) return astFactory.numericLiteral(reasons[0]!);
    return astFactory.arrayExpression(
      (reasons as number[]).map((reason) => astFactory.numericLiteral(reason)),
    );
  };
  if (astFactory.isIdentifier(target)) {
    const rest = reasonsOf(target);
    return rest === null ? null : [astFactory.objectExpression([]), rest];
  }
  if (!astFactory.isObjectPattern(target)) return null;
  const keys: t.ObjectProperty[] = [];
  let rest: t.Expression | null = null;
  for (const property of target.properties) {
    if (astFactory.isRestElement(property)) {
      rest = reasonsOf(property.argument);
      if (rest === null) return null;
      continue;
    }
    if (!isObjectProperty(property) || property.computed) return null;
    const name = propertyName(property.key);
    const reasons = reasonsOf(property.value);
    if (name === null || reasons === null) return null;
    keys.push(astFactory.objectProperty(astFactory.stringLiteral(name), reasons));
  }
  return [
    astFactory.objectExpression(keys),
    ...(rest === null ? [] : [rest]),
  ];
}

/** Clone an authored parameter for emitted JavaScript factory syntax. */
export function runtimeParameter(param: ComponentParam): ComponentParam {
  const cloned = cloneCompilerNode(param);
  stripTypeSyntax(cloned);
  return cloned;
}

function inputWithDefault(
  param: ComponentParam,
  source: t.Expression,
): t.Expression {
  if (!astFactory.isAssignmentPattern(param)) return cloneCompilerNode(source);
  return astFactory.conditionalExpression(
    astFactory.binaryExpression(
      '===',
      cloneCompilerNode(source),
      astFactory.identifier('undefined'),
    ),
    cloneCompilerNode(param.right),
    cloneCompilerNode(source),
  );
}

export function assignmentTarget(target: PropTarget): PropTarget {
  const cloned = cloneCompilerNode(target);
  stripTypeSyntax(cloned);
  return cloned;
}

function stripTypeSyntax(node: t.Node): void {
  walkAst(node, {
    enter(current) {
      const typed = current as t.Node & {
        typeAnnotation?: t.TypeAnnotation | t.TSTypeAnnotation | null;
        optional?: boolean | null;
      };
      if ('typeAnnotation' in typed) typed.typeAnnotation = null;
      if ('optional' in typed) typed.optional = null;
    },
  });
}
