/** Erase TypeScript-only syntax from a transformed TS-ESTree program. */

import { nodeFields as fields } from './access';
import { transformAst } from './transform';
import type { BaseNode } from './types';

function typeOnlyStatement(node: BaseNode): boolean {
  return (
    node.type === 'TSInterfaceDeclaration' ||
    node.type === 'TSTypeAliasDeclaration' ||
    node.type === 'TSDeclareFunction' ||
    node.type === 'TSModuleDeclaration'
  );
}

function clearTypeFields(node: BaseNode): void {
  const record = fields(node);
  delete record.typeAnnotation;
  delete record.typeParameters;
  delete record.returnType;
  delete record.typeArguments;
  delete record.superTypeArguments;
  delete record.implements;
  delete record.abstract;
  delete record.declare;
  delete record.definite;
  delete record.override;
  delete record.readonly;
  delete record.accessibility;

  if (
    node.type === 'Identifier' ||
    node.type === 'RestElement' ||
    node.type === 'PropertyDefinition' ||
    node.type === 'MethodDefinition'
  ) {
    delete record.optional;
  }
}

/**
 * Return a cloned JavaScript ESTree program with erasable TypeScript syntax
 * removed. Runtime-bearing TypeScript constructs such as enums intentionally
 * fail instead of being silently miscompiled.
 */
export function stripTypeScript<T extends BaseNode>(root: T): T {
  const stripped = transformAst(root, {
    enter(node) {
      const record = fields(node);

      if (typeOnlyStatement(node)) return null;
      if (
        node.type === 'TSEnumDeclaration' ||
        node.type === 'TSImportEqualsDeclaration' ||
        node.type === 'TSExportAssignment'
      ) {
        throw new Error(
          `memo-dom: runtime TypeScript syntax '${node.type}' is not supported by the ESTree emitter`,
        );
      }

      if (
        node.type === 'TSAsExpression' ||
        node.type === 'TSTypeAssertion' ||
        node.type === 'TSNonNullExpression' ||
        node.type === 'TSSatisfiesExpression' ||
        node.type === 'TSInstantiationExpression'
      ) {
        return record.expression as BaseNode;
      }
      if (node.type === 'TSParameterProperty') {
        return record.parameter as BaseNode;
      }

      if (node.type === 'ImportDeclaration') {
        if (record.importKind === 'type' || record.importKind === 'typeof') {
          return null;
        }
        const specifiers = record.specifiers;
        if (Array.isArray(specifiers)) {
          record.specifiers = specifiers.filter((specifier) => {
            if (specifier === null || typeof specifier !== 'object') return true;
            const kind = (specifier as Record<string, unknown>).importKind;
            return kind !== 'type' && kind !== 'typeof';
          });
        }
        delete record.importKind;
      }

      if (node.type === 'ExportNamedDeclaration') {
        if (record.exportKind === 'type') return null;
        const declaration = record.declaration;
        if (
          declaration !== null &&
          typeof declaration === 'object' &&
          'type' in declaration &&
          typeOnlyStatement(declaration as BaseNode)
        ) {
          return null;
        }
        const specifiers = record.specifiers;
        if (Array.isArray(specifiers)) {
          record.specifiers = specifiers.filter((specifier) => {
            if (specifier === null || typeof specifier !== 'object') return true;
            return (specifier as Record<string, unknown>).exportKind !== 'type';
          });
        }
        delete record.exportKind;
      }

      if (
        node.type === 'PropertyDefinition' &&
        record.declare === true &&
        record.value == null
      ) {
        return null;
      }
      if (
        (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') &&
        record.declare === true
      ) {
        return null;
      }

      clearTypeFields(node);
      return undefined;
    },
  });
  if (stripped === null) {
    throw new TypeError('Cannot erase the TypeScript program root');
  }
  return stripped;
}
