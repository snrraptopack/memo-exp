/** Normalize supported frontend node spellings to strict ESTree nodes. */

import { nodeFields as fields } from './access';
import { decodeHTMLStrict } from 'entities/decode';
import { walkAst } from './walk';
import type { BaseNode } from './types';

/** Remove TypeScript-only wrappers without changing runtime semantics. */
export function unwrapTypeExpression<TExpression extends BaseNode>(expression: TExpression): TExpression {
  let current: BaseNode = expression;
  while (['TSAsExpression', 'TSTypeAssertion', 'TSNonNullExpression',
    'TSSatisfiesExpression', 'TSInstantiationExpression'].includes(current.type)) {
    current = (current as unknown as {expression: BaseNode}).expression;
  }
  return current as TExpression;
}

/** Resolve authored JSX literals before target-independent planning or emission. */
export function normalizeJsxLiterals(root: BaseNode): void {
  walkAst(root, {
    enter(node) {
      const record = fields(node);
      if (node.type === 'JSXText' && typeof record.value === 'string') {
        const raw = typeof record.raw === 'string' ? record.raw : record.value;
        // Fold source indentation before decoding explicit whitespace entities.
        let value = raw.replace(/[ \t\r\n\f]+/g, ' ');
        if (/^[ \t\r\f]*\n/.test(raw)) value = value.replace(/^ /, '');
        if (/\n[ \t\r\f]*$/.test(raw)) value = value.replace(/ $/, '');
        record.value = typeof record.raw === 'string' ? decodeHTMLStrict(value) : value;
      } else if (node.type === 'JSXAttribute') {
        const value = record.value as BaseNode | null;
        if (!value || !['Literal', 'StringLiteral'].includes(value.type)) return;
        const literal = fields(value);
        const extra = literal.extra as {raw?: string} | undefined;
        const raw = extra?.raw ?? literal.raw;
        if (typeof literal.value !== 'string' || typeof raw !== 'string' ||
            !['"', "'"].includes(raw[0]!) || raw.at(-1) !== raw[0]) return;
        literal.value = decodeHTMLStrict(raw.slice(1, -1));
        // Preserve the authored JSX spelling across AST clones/re-entry. The
        // printer consumes raw as JavaScript after the attribute is lowered.
        literal.extra = {...extra, raw};
        literal.raw = JSON.stringify(literal.value);
      }
    },
  });
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
 * Convert supported frontend literal/property spellings into the ESTree dialect
 * consumed by parser-neutral printers and alternate frontends.
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
