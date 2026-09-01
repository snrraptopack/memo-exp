/** Normalize transitional Babel-shaped output nodes to strict ESTree nodes. */

import { walkAst } from './walk';
import type { BaseNode } from './types';

function fields(node: BaseNode): Record<string, unknown> {
  return node as unknown as Record<string, unknown>;
}

function literal(
  node: BaseNode,
  value: string | number | boolean | null,
  raw: string,
): void {
  const record = fields(node);
  record.type = 'Literal';
  record.value = value;
  record.raw = raw;
}

/**
 * Convert nodes created by the temporary Babel builder boundary into the
 * ESTree dialect consumed by parser-neutral printers and alternate frontends.
 * Authored ESTree nodes pass through unchanged.
 */
export function normalizeEstreeDialect(root: BaseNode): void {
  walkAst(root, {
    enter(node) {
      const record = fields(node);
      switch (node.type) {
        case 'StringLiteral': {
          const value = record.value;
          if (typeof value !== 'string') {
            throw new TypeError('StringLiteral requires a string value');
          }
          literal(node, value, JSON.stringify(value));
          break;
        }
        case 'NumericLiteral': {
          const value = record.value;
          if (typeof value !== 'number') {
            throw new TypeError('NumericLiteral requires a number value');
          }
          literal(node, value, String(value));
          break;
        }
        case 'BooleanLiteral': {
          const value = record.value;
          if (typeof value !== 'boolean') {
            throw new TypeError('BooleanLiteral requires a boolean value');
          }
          literal(node, value, String(value));
          break;
        }
        case 'NullLiteral':
          literal(node, null, 'null');
          break;
        case 'BigIntLiteral': {
          const value = record.value;
          if (typeof value !== 'string') {
            throw new TypeError('BigIntLiteral requires a string value');
          }
          record.type = 'Literal';
          record.value = BigInt(value);
          record.bigint = value;
          record.raw = `${value}n`;
          break;
        }
        case 'RegExpLiteral': {
          const pattern = record.pattern;
          const flags = record.flags;
          if (typeof pattern !== 'string' || typeof flags !== 'string') {
            throw new TypeError('RegExpLiteral requires pattern and flags');
          }
          record.type = 'Literal';
          record.value = null;
          record.regex = { pattern, flags };
          record.raw = `/${pattern}/${flags}`;
          break;
        }
        case 'ObjectProperty':
          record.type = 'Property';
          record.kind ??= 'init';
          record.method ??= false;
          record.shorthand ??= false;
          break;
      }
    },
  });
}

/** Convert strict ESTree nodes only when returning through the legacy Babel plugin. */
export function normalizeBabelDialect(root: BaseNode): void {
  walkAst(root, {
    leave(node) {
      const record = fields(node);
      if (node.type === 'MemberExpression' && record.optional === true) {
        record.type = 'OptionalMemberExpression';
        return;
      }
      if (node.type === 'CallExpression' && record.optional === true) {
        record.type = 'OptionalCallExpression';
        return;
      }
      if (node.type === 'Property') {
        record.type = 'ObjectProperty';
        return;
      }
      if (node.type !== 'Literal') return;
      const value = record.value;
      if (typeof value === 'string') {
        record.type = 'StringLiteral';
      } else if (typeof value === 'number') {
        record.type = 'NumericLiteral';
      } else if (typeof value === 'boolean') {
        record.type = 'BooleanLiteral';
      } else if (typeof value === 'bigint') {
        record.type = 'BigIntLiteral';
        record.value = value.toString();
      } else if (record.regex !== undefined) {
        const regex = record.regex;
        if (regex && typeof regex === 'object') {
          const descriptor = regex as Record<string, unknown>;
          record.type = 'RegExpLiteral';
          record.pattern = descriptor.pattern;
          record.flags = descriptor.flags;
        }
      } else {
        record.type = 'NullLiteral';
        delete record.value;
      }
      delete record.raw;
    },
  });
}
