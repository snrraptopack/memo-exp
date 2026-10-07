/** Discovers component props that carry JSX render content. */
import type * as t from '../ast/compiler-types';
import * as astFactory from '../ast/factory';
import {
  isExpression as isAstExpression,
  walkAst,
  type BaseNode,
} from '../ast';
import {
  type ComponentPath,
  type Ctx,
} from '../context';
import { renderPropReferenceName } from './render-prop-reference';
import { subtreeHasJsx } from './module-discovery';
import { resolveRenderUsage, type ComponentPropUsage } from '../components/render-usage';

function scalarTsType(
  type: t.TSType,
  program: t.Program,
  visiting = new Set<string>(),
): boolean {
  if (
    astFactory.isTSStringKeyword(type) ||
    astFactory.isTSNumberKeyword(type) ||
    astFactory.isTSBooleanKeyword(type) ||
    astFactory.isTSBigIntKeyword(type) ||
    astFactory.isTSSymbolKeyword(type) ||
    astFactory.isTSNullKeyword(type) ||
    astFactory.isTSUndefinedKeyword(type) ||
    astFactory.isTSLiteralType(type)
  ) {
    return true;
  }
  if (astFactory.isTSParenthesizedType(type)) {
    return scalarTsType(type.typeAnnotation, program, visiting);
  }
  if (astFactory.isTSUnionType(type)) {
    return type.types.every((member) =>
      scalarTsType(member, program, visiting),
    );
  }
  if (astFactory.isTSTypeReference(type) && astFactory.isIdentifier(type.typeName)) {
    const name = type.typeName.name;
    if (visiting.has(name)) return false;
    const next = new Set(visiting);
    next.add(name);
    for (const statement of program.body) {
      const declaration: t.Node | null = astFactory.isExportNamedDeclaration(statement)
        ? statement.declaration
        : statement;
      if (
        astFactory.isTSTypeAliasDeclaration(declaration) &&
        declaration.id.name === name
      ) {
        return scalarTsType(declaration.typeAnnotation, program, next);
      }
    }
  }
  return false;
}

function declaredScalarProp(
  component: t.FunctionDeclaration,
  program: t.Program,
  prop: string,
): boolean {
  const hasNodeType = (node: object, type: string): boolean =>
    (node as unknown as { type?: unknown }).type === type;
  const scalarDefault = (expression: t.Expression): boolean =>
    astFactory.isStringLiteral(expression) ||
    astFactory.isNumericLiteral(expression) ||
    astFactory.isBooleanLiteral(expression) ||
    astFactory.isBigIntLiteral(expression) ||
    (hasNodeType(expression, 'Literal') &&
      (typeof (expression as unknown as { value?: unknown }).value === 'string' ||
        typeof (expression as unknown as { value?: unknown }).value === 'number' ||
        typeof (expression as unknown as { value?: unknown }).value === 'boolean' ||
        typeof (expression as unknown as { value?: unknown }).value === 'bigint')) ||
    (astFactory.isUnaryExpression(expression) &&
      (expression.operator === '+' || expression.operator === '-') &&
      (astFactory.isNumericLiteral(expression.argument) ||
        (hasNodeType(expression.argument, 'Literal') &&
          typeof (expression.argument as unknown as { value?: unknown }).value === 'number')));
  const keyName = (key: t.Expression | t.PrivateName): string | null => {
    if (astFactory.isIdentifier(key)) return key.name;
    if (astFactory.isStringLiteral(key)) return key.value;
    if (hasNodeType(key, 'Literal')) {
      const value = (key as unknown as { value?: unknown }).value;
      return typeof value === 'string' ? value : null;
    }
    return null;
  };
  for (const parameter of component.params) {
    if (astFactory.isTSParameterProperty(parameter)) continue;
    if (
      astFactory.isAssignmentPattern(parameter) &&
      astFactory.isIdentifier(parameter.left, { name: prop }) &&
      scalarDefault(parameter.right)
    ) {
      return true;
    }
    if (
      astFactory.isAssignmentPattern(parameter) &&
      astFactory.isObjectPattern(parameter.left) &&
      astFactory.isObjectExpression(parameter.right)
    ) {
      const defaultProperty = parameter.right.properties.find((property) => {
        if (!astFactory.isObjectProperty(property) || property.computed) return false;
        return keyName(property.key) === prop;
      });
      if (
        astFactory.isObjectProperty(defaultProperty) &&
        astFactory.isExpression(defaultProperty.value) &&
        scalarDefault(defaultProperty.value)
      ) {
        return true;
      }
    }
    const parameterTarget = astFactory.isAssignmentPattern(parameter)
      ? parameter.left
      : parameter;
    if (!astFactory.isObjectPattern(parameterTarget)) continue;
    for (const property of parameterTarget.properties) {
      if (!astFactory.isObjectProperty(property) || property.computed) continue;
      if (
        keyName(property.key) === prop &&
        astFactory.isAssignmentPattern(property.value) &&
        scalarDefault(property.value.right)
      ) {
        return true;
      }
    }
  }

  const first = component.params[0];
  if (first == null || astFactory.isTSParameterProperty(first)) return false;
  const target = astFactory.isAssignmentPattern(first) ? first.left : first;
  if (
    !astFactory.isIdentifier(target) &&
    !astFactory.isObjectPattern(target) &&
    !astFactory.isArrayPattern(target)
  ) {
    return false;
  }
  const annotation = target.typeAnnotation;
  if (!astFactory.isTSTypeAnnotation(annotation)) return false;

  let shape = annotation.typeAnnotation;
  if (astFactory.isTSTypeReference(shape) && astFactory.isIdentifier(shape.typeName)) {
    const referenceName = shape.typeName.name;
    let declaration: t.TSInterfaceDeclaration | t.TSTypeAliasDeclaration | null = null;
    for (const statement of program.body) {
      const candidate: unknown = astFactory.isExportNamedDeclaration(statement)
        ? statement.declaration
        : statement;
      if (
        astFactory.isTSInterfaceDeclaration(candidate) &&
        candidate.id.name === referenceName
      ) {
        declaration = candidate;
        break;
      }
      if (
        astFactory.isTSTypeAliasDeclaration(candidate) &&
        candidate.id.name === referenceName
      ) {
        declaration = candidate;
        break;
      }
    }
    if (astFactory.isTSInterfaceDeclaration(declaration)) {
      shape = astFactory.tsTypeLiteral(declaration.body.body);
    } else if (astFactory.isTSTypeAliasDeclaration(declaration)) {
      shape = declaration.typeAnnotation;
    }
  }
  if (!astFactory.isTSTypeLiteral(shape)) return false;
  for (const member of shape.members) {
    if (!astFactory.isTSPropertySignature(member) || member.computed) continue;
    if (
      keyName(member.key) === prop &&
      astFactory.isTSTypeAnnotation(member.typeAnnotation)
    ) {
      return scalarTsType(
        member.typeAnnotation.typeAnnotation,
        program,
      );
    }
  }
  return false;
}

function expressionCarriesJsx(
  ctx: Ctx,
  expression: BaseNode,
  visiting = new Set<BaseNode>(),
): boolean {
  if (subtreeHasJsx(expression)) return true;
  if (visiting.has(expression)) return false;
  visiting.add(expression);
  if (expression.type === 'Identifier') {
    const name = (expression as unknown as { name: string }).name;
    const binding = ctx.astAnalysis?.nodeToScope.get(expression)?.getBinding(name);
    let declaration: BaseNode | null = binding?.identifier ?? null;
    while (
      declaration !== null &&
      declaration !== binding?.declarationNode &&
      declaration.type !== 'VariableDeclarator'
    ) {
      declaration = ctx.astAnalysis?.parentByNode.get(declaration) ?? null;
    }
    if (declaration?.type === 'VariableDeclarator') {
      const init = (declaration as unknown as { init?: unknown }).init;
      return isAstExpression(init)
        ? expressionCarriesJsx(ctx, init, visiting)
        : false;
    }
  }
  if (expression.type === 'MemberExpression') {
    const object = (expression as unknown as { object?: unknown }).object;
    return isAstExpression(object)
      ? expressionCarriesJsx(ctx, object, visiting)
      : false;
  }
  return false;
}

/**
 * Discover props that are consumed as mount slots. Direct JSX-child use is
 * the defining contract; forwarding through another declared render prop is
 * propagated to a fixed point for wrapper components.
 */
export function scanRenderProps(ctx: Ctx): void {
  const program = ctx.astAnalysis?.rootScope.block;
  if (program?.type !== 'Program') return;
  const potential = new Map<string, Set<string>>();
  for (const [name, componentPath] of ctx.compPaths) {
    const candidates = new Set<string>();
    potential.set(name, candidates);
    walkAst<BaseNode>(componentPath.node as unknown as BaseNode, {
      enter(node, parent) {
        if (node.type !== 'JSXExpressionContainer') return;
        if (
          parent?.type !== 'JSXElement' &&
          parent?.type !== 'JSXFragment'
        ) {
          return;
        }
        const expression = (node as unknown as { expression?: unknown }).expression;
        if (!isAstExpression(expression)) return;
        const prop = renderPropReferenceName(ctx, name, expression);
        if (prop === null) return;
        if (
          !declaredScalarProp(
            componentPath.node,
            program as unknown as t.Program,
            prop,
          )
        ) {
          candidates.add(prop);
        }
      },
    });
    const componentParent = ctx.astAnalysis?.parentByNode.get(
      componentPath.node as unknown as BaseNode,
    ) ?? null;
    if (
      (componentParent?.type === 'ExportNamedDeclaration' ||
        componentParent?.type === 'ExportDefaultDeclaration') &&
      !ctx.linkedComponentRenderProps.has(name)
    ) {
      const plan = ctx.componentProps.get(name)!;
      for (const candidate of candidates) {
        if (!plan.renderProps.includes(candidate)) {
          plan.renderProps.push(candidate);
        }
      }
    }
  }

  // Untyped interpolation is scalar by default. Positive caller JSX evidence
  // declares a mount slot; linked callers provide the same evidence through
  // linkedComponentRenderProps below. This avoids guessing from host layout.
  const localUsage: ComponentPropUsage[] = [];
  const usageSites = new Map<string, ComponentPath>();
  for (const [owner, ownerPath] of ctx.compPaths) {
    walkAst<BaseNode>(ownerPath.node as unknown as BaseNode, {
      enter(node) {
        if (node.type !== 'JSXElement') return;
        const element = node as unknown as t.JSXElement;
        const tag = element.openingElement.name;
        if (!astFactory.isJSXIdentifier(tag) || !ctx.comps.has(tag.name)) return;
        const component = tag.name;
        const candidates = potential.get(component);
        if (candidates === undefined) return;
        function record(prop:string,kind:ComponentPropUsage['kind'],sourceProp?:string):void {
          localUsage.push({target:component,prop,kind,
            ...(sourceProp===undefined?{}:{forwardedFrom:{target:owner,prop:sourceProp}})});
          usageSites.set(`${component}\0${prop}`,ownerPath);
        }
        if (
          candidates.has('children') &&
          element.children.some(
            (child) =>
              !astFactory.isJSXText(child) || child.value !== '',
          )
        ) {
          record('children','jsx');
        }
        for (const attribute of element.openingElement.attributes) {
          if (!astFactory.isJSXAttribute(attribute)) continue;
          const name = attribute.name;
          const prop = astFactory.isJSXIdentifier(name) ? name.name : name.name.name;
          const value = attribute.value;
          let carriesJsx = false;
          if (
            astFactory.isJSXExpressionContainer(value) &&
            isAstExpression(value.expression)
          ) {
            if (expressionCarriesJsx(ctx, value.expression)) {
              carriesJsx = true;
            } else {
              const sourceProp=renderPropReferenceName(ctx,owner,value.expression);
              if(sourceProp!==null) {
                record(prop,'scalar',sourceProp);
                continue;
              }
            }
          }
          record(prop,carriesJsx?'jsx':'scalar');
        }
      },
    });
  }
  for (const [component, usage] of resolveRenderUsage(localUsage)) {
    const plan = ctx.componentProps.get(component)!;
    for (const prop of new Set([...usage.scalar,...usage.jsx])) {
      if (!potential.get(component)?.has(prop)) continue;
      if (usage.scalar.has(prop) && usage.jsx.has(prop)) {
        if (prop === 'children') {
          if (!plan.renderProps.includes(prop)) plan.renderProps.push(prop);
          continue;
        }
        throw usageSites.get(`${component}\0${prop}`)!.buildCodeFrameError(
          `memo-dom: prop '${prop}' on <${component}> is used as both scalar data and JSX content`,
        );
      }
      if (usage.jsx.has(prop)) {
        if (!plan.renderProps.includes(prop)) plan.renderProps.push(prop);
      } else if (usage.scalar.has(prop)) {
        plan.renderProps = plan.renderProps.filter(
          (candidate) => candidate !== prop,
        );
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, componentPath] of ctx.compPaths) {
      const plan = ctx.componentProps.get(name)!;
      walkAst<BaseNode>(componentPath.node as unknown as BaseNode, {
        enter(node, parent) {
          if (node.type !== 'JSXAttribute') return;
          const attribute = node as unknown as t.JSXAttribute;
          const container = attribute.value;
          if (
            !astFactory.isJSXExpressionContainer(container) ||
            !isAstExpression(container.expression)
          ) {
            return;
          }
          const sourceProp = renderPropReferenceName(
            ctx,
            name,
            container.expression,
          );
          if (sourceProp === null || plan.renderProps.includes(sourceProp)) {
            return;
          }
          if (parent?.type !== 'JSXOpeningElement') return;
          const tag = (parent as unknown as t.JSXOpeningElement).name;
          if (!astFactory.isJSXIdentifier(tag) || !/^[A-Z]/.test(tag.name)) return;
          const target = ctx.componentProps.get(tag.name);
          const attr = attribute.name;
          const attrName = astFactory.isJSXIdentifier(attr) ? attr.name : attr.name.name;
          if (target?.renderProps.includes(attrName) === true) {
            plan.renderProps.push(sourceProp);
            changed = true;
          }
        },
      });
    }
  }

  for (const [component, renderProps] of ctx.linkedComponentRenderProps) {
    const plan = ctx.componentProps.get(component);
    if (plan !== undefined) plan.renderProps = [...renderProps];
  }
}
