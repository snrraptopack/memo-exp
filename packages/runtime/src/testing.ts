/**
 * Testing-only runtime entry with registry and props-box introspection.
 *
 * Keeping these exports out of the production entry prevents test diagnostics
 * from becoming part of application bundles.
 */

export * from './index';
export { _internals } from './kernel';
export { _propsBox } from './props';
