/** DOM owns generated output and host binding plans; shared context owns source facts. */
import { createAnalysisCtx, type AnalysisOptions } from '../context/model';
import type {Ctx as AnalysisContext} from '../context/model';
import type { InitialBrowserRoot } from './browser-plan';
import type { InitialDelivery } from './delivery-plan';
import type { InitialDomRoot } from './initial-dom';
import { createDomEmissionState, type DomEmissionState } from './state';

export interface InternalMemoDomOptions extends AnalysisOptions {
  /** Emitted helper requirements, including retained future factories. */
  onRuntimeHelpers?: (helpers: ReadonlySet<string>) => void;
  initialDelivery?: InitialDelivery;
  /** Placements selected before emitting the document's browser program. */
  initialBrowserRoot?: InitialBrowserRoot;
  initialDomRoot?: InitialDomRoot;
  initialDomComponents?: Readonly<Record<string,InitialDomRoot>>;
  /** Source anchors for request contracts; server creation remains ordinary. */
  initialServerComponents?: Readonly<Record<string,InitialDomRoot>>;
  initialMount?: { readonly payload: boolean };
}

export interface DomContext extends AnalysisContext {
  initialDelivery:InitialDelivery|undefined;
  initialBrowserRoot:InitialBrowserRoot|null;
  initialDomRoot:InitialDomRoot|null;
  initialDomComponents:Readonly<Record<string,InitialDomRoot>>;
  initialServerComponents:Readonly<Record<string,InitialDomRoot>>;
  domOnlyRowComponents:Set<string>;
  emission:DomEmissionState;
}

export function createCtx(opts:InternalMemoDomOptions={}):DomContext {
  return {...createAnalysisCtx(opts),initialDelivery:opts.initialDelivery,
    initialBrowserRoot:opts.initialBrowserRoot??null,initialDomRoot:opts.initialDomRoot??null,
    initialDomComponents:opts.initialDomComponents??{},initialServerComponents:opts.initialServerComponents??{},
    domOnlyRowComponents:new Set(),emission:createDomEmissionState()};
}
