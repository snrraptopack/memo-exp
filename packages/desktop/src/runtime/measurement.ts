import type { SceneMeasurement } from '../bridge/protocol';
import type { SceneElement } from './application';

const measurements = new WeakMap<object, () => Promise<SceneMeasurement>>();

/** Register actual native ref objects rather than trusting a duck-typed handle. */
export function registerMeasurement(element: SceneElement): void {
  measurements.set(element, () => element.measure());
}

/** Ordinary JSX refs keep their DOM authoring types; native capabilities are explicit. */
export function measureElement(element: Element | SceneElement): Promise<SceneMeasurement> {
  const measure = measurements.get(element);
  if (!measure) return Promise.reject(new Error('Measurement requires a native desktop element ref'));
  return measure();
}
