# 17-attrs

The everyday attribute surface — `className`, `style={{}}`, `htmlFor`,
`checked`, `value`, `disabled`, `data-*`, `aria-*`, `onChange`.

## What to verify

1. Toggle **enabled** → the `<p>`'s class flips `state-off` → `state-on`
   and `data-state` follows (inspect the DOM — `class` attr on the MMD side).
2. Style object: padding, margin, background switch, `borderWidth: 2`
   (unitless number → `2px`), `borderStyle` camelCase → `border-style`.
3. Click the **htmlFor → for** label — focus jumps to the input.
4. Checkbox toggles and stays controlled.
5. Typing echoes **per keystroke** in the output.
6. `disabled` button is unclickable until enabled.

## Expected React semantics being captured

- `className` → `class` (MMD accepts both spellings natively).
- `htmlFor` → `for` (mapped attribute in `jsx/dom-attributes.ts`).
- `style={{...}}` → `setStyleValue` — the runtime already accepts style
  objects, not just strings.
- `checked`/`value`/`disabled` → **DOM property writes**, not attributes.
- `data-*`/`aria-*` → `setAttribute` pass-through.
- `onChange` on text inputs is the interesting one: React's synthetic
  `onChange` fires per keystroke (it's the `input` event underneath). MMD's
  `onChange` would be the DOM `change` event — **blur/commit, not
  keystroke**. The authored equivalent is `onInput`. See the twin README.
