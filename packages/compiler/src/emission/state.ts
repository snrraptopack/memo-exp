/** Mutable DOM-backend storage; semantic plans never allocate output here. */
import type * as t from '../ast/compiler-types';
import type {GeneratedIdentifiers} from '../identifiers';

export interface DomEmissionState {
  header:t.Statement[];
  identifiers:GeneratedIdentifiers|null;
  writeConstCounter:number;
  writeConsts:Map<string,string>;
  reasonConstCounter:number;
  reasonConsts:Map<string,string>;
  markupConstCounter:number;
  markupConsts:Map<string,string>;
  listOperationConsts:Map<string,string>;
  dynamicTagSelector:string|null;
}

export function createDomEmissionState():DomEmissionState {
  return {header:[],identifiers:null,writeConstCounter:0,writeConsts:new Map(),
    reasonConstCounter:0,reasonConsts:new Map(),markupConstCounter:0,markupConsts:new Map(),
    listOperationConsts:new Map(),dynamicTagSelector:null};
}
