/** Lazy module source declarations and lexical inputs, before runtime lowering. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {childNode, cloneNode, extractPatternIdentifiers, nodeField, unwrapTypeExpression, variableDeclaratorForBinding, walkAst, type BaseNode, type Binding, type Identifier, type ScopeAnalysis} from '../ast';

type SourceInput = t.CallExpression['arguments'][number];

interface ModuleSourceBase {
  readonly declarator: t.VariableDeclarator;
  readonly name: string;
  readonly key: string;
  readonly inputs: readonly {readonly name: string; readonly binding: Binding}[];
}

export type ModuleSourcePlan = ModuleSourceBase & (
  | {readonly kind: 'fetch'; readonly bodyless?: boolean; readonly clientOnly?: boolean; readonly target?: SourceInput; readonly options?: SourceInput}
  | {readonly kind: 'read'; readonly replay: t.Expression}
);

export interface ModuleSourceStatementPlan {
  readonly statement: t.Statement;
  readonly sources: readonly ModuleSourcePlan[];
}

export function planModuleSources(
  program: t.Program,
  analysis: ScopeAnalysis,
  moduleId: string,
  factories: {readonly sources: ReadonlySet<string>; readonly forms: ReadonlySet<string>; readonly reads: ReadonlySet<string>;
    readonly bodylessFetches?: ReadonlySet<string>; readonly clientOnly?: boolean},
  errorAt: {buildCodeFrameError(message: string, at?: t.Node): Error},
): readonly ModuleSourceStatementPlan[] {
  const plans: ModuleSourceStatementPlan[] = [];
  if (factories.sources.size === 0) return Object.freeze(plans);
  for (const statement of program.body) {
    const declaration = astFactory.isExportNamedDeclaration(statement) ? statement.declaration : statement;
    if (!astFactory.isVariableDeclaration(declaration)) continue;
    const sources: ModuleSourcePlan[] = [];
    for (const declarator of declaration.declarations) {
      const call = declarator.init;
      if (!astFactory.isIdentifier(declarator.id) || !astFactory.isCallExpression(call) ||
          !astFactory.isIdentifier(call.callee) || !factories.sources.has(call.callee.name) ||
          factories.forms.has(call.callee.name) ||
          analysis.nodeToScope.get(call)?.getBinding(call.callee.name)?.kind !== 'import') continue;
      const inputs = new Map<Binding, {readonly name: string; readonly binding: Binding}>();
      const followed = new Set<Binding>();
      const writeTargets = new Set<BaseNode>();
      const capture = (argument: BaseNode, replayCalls = false): void => walkAst(argument, {enter(node) {
        if ((node.type === 'AssignmentExpression' && nodeField(node, 'operator') === '=') ||
            node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
          const target = childNode(node, 'left');
          if (target !== null) for (const identifier of extractPatternIdentifiers(target)) writeTargets.add(identifier);
        }
        if (replayCalls && astFactory.isCallExpression(node)) followReplay(node.callee as unknown as BaseNode);
        if (!astFactory.isIdentifier(node) || writeTargets.has(node as unknown as BaseNode)) return;
        const binding = analysis.nodeToScope.get(node)?.getBinding(node.name);
        // Scope analysis excludes property/type names and declaration identifiers.
        // Keep real references inside callbacks as well as their immediate inputs.
        if (binding?.scope.isProgramScope && binding.references.includes(node as unknown as Identifier)) {
          inputs.set(binding, Object.freeze({name: binding.name, binding}));
        }
      }});
      const followReplay = (expression: BaseNode): void => {
        const unwrapped = unwrapTypeExpression(expression);
        if (astFactory.isArrowFunctionExpression(unwrapped) || astFactory.isFunctionExpression(unwrapped)) {
          capture(unwrapped as unknown as BaseNode, true);return;
        }
        if (!astFactory.isIdentifier(unwrapped)) return;
        const binding = analysis.nodeToScope.get(unwrapped)?.getBinding(unwrapped.name);
        if (binding?.scope.isProgramScope !== true || followed.has(binding)) return;
        followed.add(binding);
        if (binding.kind === 'function' && astFactory.isFunctionDeclaration(binding.declarationNode)) {
          capture(binding.declarationNode, true);return;
        }
        const declaration = variableDeclaratorForBinding(analysis, binding);
        if (binding.kind === 'const' && binding.constantViolations.length === 0 &&
            astFactory.isVariableDeclarator(declaration) && astFactory.isIdentifier(declaration.id) &&
            declaration.id === binding.identifier && astFactory.isExpression(declaration.init)) {
          followReplay(declaration.init as unknown as BaseNode);
        }
      };
      for (const argument of call.arguments.slice(0, 2)) capture(argument as unknown as BaseNode);
      if (factories.reads.has(call.callee.name) && call.arguments[1] !== undefined) {
        followReplay(call.arguments[1] as unknown as BaseNode);
      }
      const base = {declarator, name: declarator.id.name, key: `${moduleId}#${declarator.id.name}`,
        inputs: Object.freeze([...inputs.values()])};
      const [target, options] = call.arguments;
      if (factories.reads.has(call.callee.name)) {
        if (!astFactory.isExpression(target) || !astFactory.isExpression(options)) {
          throw errorAt.buildCodeFrameError('memo-dom: module $read requires a promise expression and a replay expression', call);
        }
        sources.push(Object.freeze({...base, kind: 'read', replay: cloneNode(options, true)}));
      } else {
        sources.push(Object.freeze({...base, kind: 'fetch',
          ...(factories.bodylessFetches?.has(call.callee.name) ? {bodyless: true, clientOnly:factories.clientOnly === true} : {}),
          ...(target === undefined ? {} : {target: cloneNode(target, true)}),
          ...(options === undefined ? {} : {options: cloneNode(options, true)})}));
      }
    }
    if (sources.length > 0) plans.push(Object.freeze({statement, sources: Object.freeze(sources)}));
  }
  return Object.freeze(plans);
}
