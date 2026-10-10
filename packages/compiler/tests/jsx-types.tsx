/** General JSX compile-only assertions run by bun check -p packages/compiler/tsconfig.test.json. */
import type {} from '@memoized-dom/compiler/jsx';

type Assert<T extends true> = T;
type IsAny<T> = 0 extends (1 & T) ? true : false;
export type JSXIsNotAny = Assert<IsAny<JSX.Element> extends false ? true : false>;
export type InputPropsAreNotAny = Assert<IsAny<JSX.IntrinsicElements['input']> extends false ? true : false>;
export type EveryHTMLTag = Assert<keyof HTMLElementTagNameMap extends keyof JSX.IntrinsicElements ? true : false>;
export type EverySVGTag = Assert<keyof SVGElementTagNameMap extends keyof JSX.IntrinsicElements ? true : false>;
export type EveryMathMLTag = Assert<keyof MathMLElementTagNameMap extends keyof JSX.IntrinsicElements ? true : false>;

export function nativeJSXTypes() {
  const input = <input type="text" onInput={event => {
    const value: string = event.currentTarget.value;
    const native: Event = event;
    return [value, native];
  }} onKeyDown={event => {
    const key: string = event.key;
    const native: KeyboardEvent = event;
    return [key, native, event.currentTarget.selectionStart];
  }} />;
  const button = <button disabled onClick={event => {
    const native: MouseEvent = event;
    return [event.clientX, event.currentTarget.disabled, native];
  }} />;
  const form = <form onSubmit={event => {
    const native: SubmitEvent = event;
    return [event.submitter, event.currentTarget.elements, native];
  }} />;
  const svg = <svg viewBox="0 0 24 24"><circle cx={12} cy={12} r={8} fill="red" onPointerDown={event => {
    const native: PointerEvent = event;
    return [event.pressure, event.currentTarget.cx.baseVal.value, native];
  }} /></svg>;
  const math = <math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>;
  const attributes = <textarea rows={4} maxLength={120} aria-label="Notes" data-row={2} class={['field', { active: true }, [null, false, 'nested']]} style={{ paddingTop: 12, 'background-color': 'white', '--accent': 'red' }} />;
  const component = ({ text }: { text: string }) => <p>{text}</p>;
  type ComponentReturnIsNotAny = Assert<IsAny<ReturnType<typeof component>> extends false ? true : false>;
  const typedReturn: ComponentReturnIsNotAny = true;
  const element: Node = component({ text: 'Typed component' });
  // @ts-expect-error JSX expressions cannot silently become any.
  const invalidElement: number = <div />;
  // @ts-expect-error Arbitrary objects are not renderable children.
  const invalidChild = <div>{{ arbitrary: true }}</div>;
  // @ts-expect-error Component props remain checked through ElementType.
  const invalidComponent = <TypedComponent count="wrong" />;
  // @ts-expect-error Element-specific properties must not leak between tags.
  const badDiv = <div rows={3} />;
  // @ts-expect-error Native event properties must retain their real types.
  const badKey = <input onKeyDown={event => { const key: number = event.key; return key; }} />;
  // @ts-expect-error A button is not a text input.
  const badButton = <button onClick={event => event.currentTarget.selectionStart} />;
  // @ts-expect-error Known tags no longer accept arbitrary misspelled attributes.
  const typo = <input placehoder="typo" />;
  return [input, button, form, svg, math, attributes, badDiv, badKey, badButton, typo, typedReturn, element, invalidElement, invalidChild, invalidComponent];
}

function TypedComponent({ count }: { count: number }) { return <span>{count}</span>; }
