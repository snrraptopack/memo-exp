# 17-attrs (MMD equivalent)

The attr surface is almost entirely native — the shared host-element
pipeline accepts React spellings directly.

## Mapping demonstrated

| React | authored MMD |
|---|---|
| `className` | `className` **or** `class` — both compile to `setClassValue` |
| `style={{...}}` | same object syntax works (`setStyleValue` object path) — `style="…"` string also valid |
| `htmlFor` | `htmlFor` — mapped to `for` by `jsx/dom-attributes.ts` |
| `checked` / `value` / `disabled` | same — DOM **property** writes, not attributes |
| `data-*` / `aria-*` | same — `setAttribute` pass-through |
| `onChange` (text input) | **`onInput`** — see below |

## The `onChange` difference

React's synthetic `onChange` on `<input>` is really the `input` event — it
fires **per keystroke**. DOM `change` fires on **blur/commit**. Authored
MMD wires handlers to real DOM events, so `onChange` here is blur-time —
the per-keystroke equivalent is `onInput`. The React twin uses `onChange`;
this file uses `onInput`, and both echo per keystroke.

Lowering consequence: React `onChange` on text controls must translate to
MMD `onInput` (checkbox/radio `change` is already equivalent — it fires on
toggle, which is why the checkbox above keeps `onChange`).

## Same checklist as the React version

1. Class flip + `data-state` on toggle.
2. Style object AND style string both apply.
3. Label click focuses.
4. Controlled checkbox + per-keystroke echo.
5. `disabled` gates the button.

## Notes / divergences

_(fill in when verified)_
