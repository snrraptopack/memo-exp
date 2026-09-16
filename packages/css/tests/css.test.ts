import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearRegistry,
  cond,
  css,
  emitProgram,
  getCssText,
  keyframes,
  param,
  style,
  vars,
} from '../src/index';
import { classify } from '../src/classify';
import type { Color, Length } from '../src/index';

beforeEach(clearRegistry);

describe('static styles', () => {
  it('emits a hashed class with kebab-cased declarations', () => {
    const ref = css({ display: 'flex', borderRadius: '8px', padding: '16px' });
    expect(ref.class).toMatch(/^m[a-z0-9]+$/);
    expect(getCssText()).toBe(
      `.${ref.class} { display: flex; border-radius: 8px; padding: 16px; }`,
    );
  });

  it('dedupes identical styles into the same class', () => {
    const a = css({ color: 'red' });
    const b = css({ color: 'red' });
    expect(a.class).toBe(b.class);
    expect(getCssText().split('\n')).toHaveLength(1);
  });

  it('different content gets a different class', () => {
    const a = css({ color: 'red' });
    const b = css({ color: 'blue' });
    expect(a.class).not.toBe(b.class);
  });

  it('StyleRef is spreadable and stringifies to the class', () => {
    const ref = css({ color: 'red' });
    expect({ ...ref }).toEqual({ class: ref.class });
    expect(`x ${ref}`).toBe(`x ${ref.class}`);
  });
});

describe('contexts', () => {
  it('pseudo keys become selector suffixes', () => {
    const ref = css({
      padding: '8px',
      hover: { color: 'blue' },
      before: { content: '"•"' },
    });
    expect(getCssText()).toContain(`.${ref.class} { padding: 8px; }`);
    expect(getCssText()).toContain(`.${ref.class}:hover { color: blue; }`);
    expect(getCssText()).toContain(`.${ref.class}::before { content: "•"; }`);
  });

  it('parameterized pseudos pass through', () => {
    const ref = css({ 'nth-child(2)': { fontWeight: 'bold' } });
    expect(getCssText()).toContain(`.${ref.class}:nth-child(2) { font-weight: bold; }`);
  });

  it('selector keys nest as descendants, & self-refers', () => {
    const ref = css({
      '.icon': { marginRight: '8px' },
      '&.active': { fontWeight: 'bold' },
      '> *': { flexShrink: 0 },
    });
    const text = getCssText();
    expect(text).toContain(`.${ref.class} .icon { margin-right: 8px; }`);
    expect(text).toContain(`.${ref.class}.active { font-weight: bold; }`);
    expect(text).toContain(`.${ref.class} > * { flex-shrink: 0; }`);
  });

  it('media blocks wrap with a typed feature query', () => {
    const ref = css({
      padding: '8px',
      media: { minWidth: '40rem', orientation: 'landscape', style: { padding: '16px' } },
    });
    expect(getCssText()).toContain(
      `@media (min-width: 40rem) and (orientation: landscape) { .${ref.class} { padding: 16px; } }`,
    );
  });

  it('supports blocks emit their query', () => {
    const ref = css({
      display: 'flex',
      supports: { query: { display: 'grid' }, style: { display: 'grid' } },
    });
    expect(getCssText()).toContain(
      `@supports (display: grid) { .${ref.class} { display: grid; } }`,
    );
  });

  it('contexts nest', () => {
    const ref = css({
      media: { minWidth: '40rem', style: { hover: { color: 'red' } } },
    });
    expect(getCssText()).toContain(
      `@media (min-width: 40rem) { .${ref.class}:hover { color: red; } }`,
    );
  });
});

describe('value maps', () => {
  it('split into base + sorted media blocks', () => {
    const ref = css({
      padding: { base: '8px', '>=40rem': '16px', '>=64rem': '24px' },
    });
    expect(getCssText()).toBe(
      `.${ref.class} { padding: 8px; }\n` +
        `@media (width >= 40rem) { .${ref.class} { padding: 16px; } }\n` +
        `@media (width >= 64rem) { .${ref.class} { padding: 24px; } }`,
    );
  });

  it('supports < and .. range forms', () => {
    css({ width: { '<30rem': '100%', '30rem..60rem': '50%' } });
    const text = getCssText();
    expect(text).toContain(`@media (width < 30rem)`);
    expect(text).toContain(`@media (30rem <= width <= 60rem)`);
  });

  it('rejects bad map keys', () => {
    expect(() => css({ padding: { dark: '8px' } as never })).toThrow(
      /invalid value-map key/,
    );
  });
});

describe('style functions', () => {
  it('specialize per call — literals become static CSS', () => {
    const badge = css(($: { size: Length; tone: Color }) => ({
      width: $.size,
      height: $.size,
      background: $.tone,
      borderRadius: '50%',
    }));

    const a = badge({ size: '24px', tone: 'tomato' });
    expect(getCssText()).toContain(
      `.${a.class} { width: 24px; height: 24px; background: tomato; border-radius: 50%; }`,
    );

    const b = badge({ size: '32px', tone: 'tomato' });
    expect(b.class).not.toBe(a.class);

    // same args → same class (dedupe)
    expect(badge({ size: '32px', tone: 'tomato' }).class).toBe(b.class);
  });

  it('ternaries evaluate at the call site in interpreted mode', () => {
    const btn = css(($: { primary: boolean }) => ({
      color: $.primary ? 'white' : 'black',
    }));
    const on = btn({ primary: true });
    const off = btn({ primary: false });
    expect(on.class).not.toBe(off.class);
    expect(getCssText()).toContain(`color: white;`);
    expect(getCssText()).toContain(`color: black;`);
  });
});

describe('fragments', () => {
  it('spread object fragments into bodies', () => {
    const focusable = style({
      focusVisible: { outline: '2px solid currentColor' },
    });
    const ref = css({ ...focusable, color: 'red' });
    expect(getCssText()).toContain(`.${ref.class}:focus-visible { outline: 2px solid currentColor; }`);
  });

  it('fragment functions take explicit args', () => {
    const sized = style(($: { size: Length }) => ({ width: $.size, height: $.size }));
    const ref = css(($: { size: Length }) => ({
      ...sized({ size: $.size }),
      borderRadius: '50%',
    }));
    ref({ size: '40px' });
    expect(getCssText()).toContain(`width: 40px; height: 40px; border-radius: 50%;`);
  });
});

describe('vars', () => {
  it('declare scoped custom properties and typed refs', () => {
    const theme = vars({ accent: '#f60', fg: '#111' });
    expect(getCssText()).toContain(`.${theme.class} { --${theme.class}-accent: #f60; --${theme.class}-fg: #111; }`);

    const link = css({ color: theme.accent, hover: { color: theme.fg } });
    const text = getCssText();
    expect(text).toContain(`.${link.class} { color: var(--${theme.class}-accent); }`);
    expect(text).toContain(`:hover { color: var(--${theme.class}-fg); }`);
  });

  it('VarRefs stringify for interpolation', () => {
    const theme = vars({ w: '8px' });
    expect(`border: 1px ${theme.w}`).toBe(`border: 1px var(--${theme.class}-w)`);
  });
});

describe('keyframes', () => {
  it('emit @keyframes and return the hashed name', () => {
    const spin = keyframes({
      from: { transform: 'rotate(0)' },
      to: { transform: 'rotate(360deg)' },
    });
    expect(getCssText()).toContain(
      `@keyframes ${spin} { from { transform: rotate(0); } to { transform: rotate(360deg); } }`,
    );
    css({ animation: `1s linear infinite ${spin}` });
    expect(getCssText()).toContain(`animation: 1s linear infinite ${spin};`);
  });
});

describe('grammar: param and cond nodes (compiler-facing)', () => {
  it('param lowers to a scoped var, recorded in the manifest', () => {
    const program = classify(
      { width: param('size'), padding: param('pad', '8px') } as never,
      'm',
    );
    const text = emitProgram(program);
    expect(text).toBe(
      `.m { width: var(--m-size); padding: var(--m-pad, 8px); }`,
    );
    expect(program.params).toEqual([
      { name: 'size', varName: '--m-size' },
      { name: 'pad', varName: '--m-pad' },
    ]);
  });

  it('cond lifts to a variant class pair sharing one condition', () => {
    const program = classify(
      {
        padding: '8px',
        color: cond('active', 'white', 'black'),
        cursor: cond('active', 'pointer', 'default'),
      } as never,
      'm',
    );
    const text = emitProgram(program);
    expect(text).toBe(
      `.m { padding: 8px; }\n` +
        `.mv0t { color: white; cursor: pointer; }\n` +
        `.mv0f { color: black; cursor: default; }`,
    );
    expect(program.variants).toEqual([
      { id: 'active', whenClass: 'mv0t', elseClass: 'mv0f' },
    ]);
  });

  it('conds respect the surrounding context', () => {
    const program = classify(
      { hover: { background: cond('hot', 'red', 'pink') } } as never,
      'm',
    );
    expect(emitProgram(program)).toBe(
      `.mv0t:hover { background: red; }\n.mv0f:hover { background: pink; }`,
    );
  });

  it('maps and conds compose — cond inside a range slot', () => {
    const program = classify(
      { padding: { base: '8px', '>=40rem': cond('big', '32px', '16px') } } as never,
      'm',
    );
    const text = emitProgram(program);
    expect(text).toBe(
      `.m { padding: 8px; }\n` +
        `@media (width >= 40rem) { .mv0t { padding: 32px; } }\n` +
        `@media (width >= 40rem) { .mv0f { padding: 16px; } }`,
    );
  });
});
