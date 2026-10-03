/**
 * Public list-analysis facade. Implementation details live under lists/ so
 * callers share one stable import path without concentrating analysis here.
 */
export {
  analyzeMapSite,
  allocateMapSite,
  containsJsx,
  matchMapCall,
} from './lists/map-site';
export type { MapSite } from './lists/map-site';
export type { MapCallExpression } from './context';
