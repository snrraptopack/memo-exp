/** DOM owns generated output and host binding plans; shared context owns source facts. */
import { createAnalysisCtx, type AnalysisOptions } from '../context/model';
import type {Ctx as AnalysisContext} from '../context/model';
import type * as t from '../ast/compiler-types';
import type {BaseNode} from '../ast';
import type {ModuleCallbacks} from '../planning/module-callbacks';
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
  /** Runtime ABI allocation, separate from analyzed source names. */
  instanceReasonIds:Map<string,Map<string,number>>;
  analyzedFunctions:WeakSet<t.Node>;
  callbackPublications:Set<BaseNode>;
  handlerHasRootCommit:WeakMap<t.Node,boolean>;
  moduleCallbacks:ModuleCallbacks|null;
  routeCallsiteIds:WeakMap<t.JSXElement,string>;
  routeContextParams:Map<string,string>;
  externalReactiveImports:Map<string,{module:string;imported:string;local:string}>;
  presentationParameters:Map<string,t.Identifier>;
  initialDelivery:InitialDelivery|undefined;
  initialBrowserRoot:InitialBrowserRoot|null;
  initialDomRoot:InitialDomRoot|null;
  initialDomComponents:Readonly<Record<string,InitialDomRoot>>;
  initialServerComponents:Readonly<Record<string,InitialDomRoot>>;
  domOnlyRowComponents:Set<string>;
  emission:DomEmissionState;
}

export function createCtx(opts:InternalMemoDomOptions={}):DomContext {
  return {...createAnalysisCtx(opts),instanceReasonIds:new Map(),analyzedFunctions:new WeakSet(),
    callbackPublications:new Set(),handlerHasRootCommit:new WeakMap(),moduleCallbacks:null,initialDelivery:opts.initialDelivery,
    routeCallsiteIds:new WeakMap(),routeContextParams:new Map(),externalReactiveImports:new Map(),
    presentationParameters:new Map(),
    initialBrowserRoot:opts.initialBrowserRoot??null,initialDomRoot:opts.initialDomRoot??null,
    initialDomComponents:opts.initialDomComponents??{},initialServerComponents:opts.initialServerComponents??{},
    domOnlyRowComponents:new Set(),emission:createDomEmissionState()};
}
