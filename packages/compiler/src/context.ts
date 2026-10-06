/**
 * Stable facade for shared compiler context types and AST utilities.
 *
 * Keeping this module preserves existing imports while implementation details
 * are grouped under context/.
 */
export * from './context/model';
export * from './context/ast';
export * from './context/instance-reasons';
export {freshWriteConst,freshReasonConst,freshMarkupConst} from './emission/constants';
