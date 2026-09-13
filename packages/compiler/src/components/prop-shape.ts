import {
  childNode,
  childNodes,
  identifierName,
  nodeField as field,
  type BaseNode,
} from '../ast';

export interface ComponentPropShape {
  mode: 'positional' | 'object';
  names: string[];
  acceptsUnknown: boolean;
  bindings: string[];
  hasWholeDefault: boolean;
}

function stringKey(node: BaseNode | null): string | null {
  const identifier = identifierName(node);
  if (identifier !== null) return identifier;
  if (node?.type !== 'Literal' && node?.type !== 'StringLiteral') return null;
  const value = field(node, 'value');
  return typeof value === 'string' ? value : null;
}

function parameterTarget(parameter: BaseNode): BaseNode {
  if (parameter.type === 'RestElement') {
    throw new Error('rest component parameters are not supported');
  }
  const target =
    parameter.type === 'AssignmentPattern'
      ? childNode(parameter, 'left')
      : parameter;
  if (
    target === null ||
    (target.type !== 'Identifier' &&
      target.type !== 'ObjectPattern' &&
      target.type !== 'ArrayPattern')
  ) {
    throw new Error('unsupported component parameter target');
  }
  return target;
}

function bindingNames(pattern: BaseNode): string[] {
  const name = identifierName(pattern);
  if (name !== null) return [name];
  if (pattern.type === 'AssignmentPattern') {
    const left = childNode(pattern, 'left');
    return left === null ? [] : bindingNames(left);
  }
  if (pattern.type === 'RestElement') {
    const argument = childNode(pattern, 'argument');
    return argument === null ? [] : bindingNames(argument);
  }
  if (pattern.type === 'ArrayPattern') {
    return childNodes(pattern, 'elements').flatMap(bindingNames);
  }
  if (pattern.type === 'ObjectPattern') {
    return childNodes(pattern, 'properties').flatMap((property) => {
      if (property.type === 'RestElement') return bindingNames(property);
      if (property.type !== 'Property' && property.type !== 'ObjectProperty') {
        return [];
      }
      const value = childNode(property, 'value');
      return value === null ? [] : bindingNames(value);
    });
  }
  return [];
}

function objectPropertyNames(pattern: BaseNode): string[] {
  const names: string[] = [];
  for (const property of childNodes(pattern, 'properties')) {
    if (property.type === 'RestElement') continue;
    if (property.type !== 'Property' && property.type !== 'ObjectProperty') {
      throw new Error('unsupported component prop pattern property');
    }
    if (field(property, 'computed') === true) {
      throw new Error('computed keys are not supported in component prop patterns');
    }
    const name = stringKey(childNode(property, 'key'));
    if (name === null) {
      throw new Error('component prop pattern keys must be identifiers or strings');
    }
    names.push(name);
  }
  return names;
}

/** Analyze component parameter syntax without a parser-specific AST API. */
export function analyzeComponentPropShape(
  parameters: readonly BaseNode[],
): ComponentPropShape {
  if (parameters.some((parameter) => parameter.type === 'TSParameterProperty')) {
    throw new Error('TypeScript parameter properties are not valid component props');
  }
  if (parameters.length === 0) {
    return {
      mode: 'positional',
      names: [],
      acceptsUnknown: false,
      bindings: [],
      hasWholeDefault: false,
    };
  }

  const firstTarget = parameterTarget(parameters[0]!);
  const firstName = identifierName(firstTarget);
  const objectMode =
    parameters.length === 1 &&
    (firstTarget.type === 'ObjectPattern' || firstName === 'props');

  if (objectMode) {
    return {
      mode: 'object',
      names:
        firstTarget.type === 'ObjectPattern'
          ? objectPropertyNames(firstTarget)
          : [],
      acceptsUnknown:
        firstTarget.type === 'Identifier' ||
        childNodes(firstTarget, 'properties').some(
          (property) => property.type === 'RestElement',
        ),
      bindings: bindingNames(firstTarget),
      hasWholeDefault: parameters[0]!.type === 'AssignmentPattern',
    };
  }

  const names: string[] = [];
  for (const parameter of parameters) {
    const target = parameterTarget(parameter);
    const name = identifierName(target);
    if (name === null) {
      throw new Error(
        "object-destructured props must be the component's only parameter",
      );
    }
    names.push(name);
  }
  return {
    mode: 'positional',
    names,
    acceptsUnknown: false,
    bindings: parameters.flatMap((parameter) =>
      bindingNames(parameterTarget(parameter)),
    ),
    hasWholeDefault: false,
  };
}
