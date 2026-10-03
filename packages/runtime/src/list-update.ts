import type { DirtyReasons } from './dirty-reasons';

/**
 * Compiler/runtime protocol for a write proven to affect list structure.
 *
 * This describes the write's observable boundary, not the authored operation:
 * no array method names are encoded. The list still verifies keys and order;
 * the reason only proves that unchanged retained item identities do not need
 * their row content replayed.
 */
const LIST_STRUCTURE_PREFIX = '\0memo-dom:list-structure:';
const LIST_STRUCTURE_READER_SUFFIX = '\0memo-dom:list-structure-reader';
const LIST_ITEM_PREFIX = '\0memo-dom:list-item:';

export function listItemReason(source: string, index: number): string {
  return `${LIST_ITEM_PREFIX}${JSON.stringify(source)}:${index}`;
}

/** Only a complete set of matching content reasons permits selective replay. */
export function listItemIndices(reasons: DirtyReasons, source: string): number[] | null {
  const prefix = `${LIST_ITEM_PREFIX}${JSON.stringify(source)}:`;
  const values = reasons instanceof Set ? reasons : [reasons];
  const indices: number[] = [];
  for (const reason of values) {
    if (typeof reason !== 'string' || !reason.startsWith(prefix)) return null;
    const index = Number(reason.slice(prefix.length));
    if (!Number.isSafeInteger(index) || index < 0) return null;
    indices.push(index);
  }
  return indices.length === 0 ? null : indices;
}

export function listStructureReason(source: string): string {
  return `${LIST_STRUCTURE_PREFIX}${source}`;
}

export function listStructureReaderKey(source: string): string {
  return `${source}${LIST_STRUCTURE_READER_SUFFIX}`;
}

export function isStructuralListUpdate(
  reasons: DirtyReasons,
  source: string,
): boolean {
  const expected = listStructureReason(source);
  if (reasons === expected) return true;
  if (!(reasons instanceof Set) || !reasons.has(expected)) return false;
  for (const reason of reasons) {
    if (
      typeof reason !== 'string' ||
      !reason.startsWith(LIST_STRUCTURE_PREFIX)
    ) {
      return false;
    }
  }
  return true;
}

export function retainedRowNeedsSync<T>(
  previous: T,
  next: T,
  previousIndex: number,
  nextIndex: number,
  indexSensitive: boolean,
): boolean {
  return previous !== next || (indexSensitive && previousIndex !== nextIndex);
}

/** Compiler-owned trust for closed lists across guarded native operations. */
export interface ListProvenance { valid: boolean }
const ownDescriptor = Object.getOwnPropertyDescriptor;
const ownNames = Object.getOwnPropertyNames;
const prototypeOf = Object.getPrototypeOf;
const functionText = Function.prototype.toString;
const nativeApply = Reflect.apply;
const hasOwn = Object.prototype.hasOwnProperty;
const defineOwn = Object.defineProperty;
const createObject = Object.create;
const arrayPrototype = prototypeOf([]) as typeof Array.prototype;
const arrayConstructor = Array;
const realm = globalThis;
const objectPrototype = Object.prototype;
const spreadable = Symbol.isConcatSpreadable;
const species = Symbol.species;
const iterator = Symbol.iterator;

/** Descriptor reads never execute authored accessors, including inherited ones. */
function ownValue(object: object, key: PropertyKey): unknown {
  const property = ownDescriptor(object, key);
  return property !== undefined && nativeApply(hasOwn, property, ['value']) ? property.value : undefined;
}
const originalSpecies = ownDescriptor(arrayConstructor, species);
const speciesGet = originalSpecies === undefined ? undefined : ownValue(originalSpecies, 'get');
const speciesSet = originalSpecies === undefined ? undefined : ownValue(originalSpecies, 'set');
const nativeSpecies = typeof speciesGet === 'function' &&
  nativeApply(functionText, speciesGet, []) === 'function get [Symbol.species]() { [native code] }';

// Capture native identities generically. Method eligibility and required guards
// belong to the compiler's central list-method table, not a second runtime table.
type CapturedNative = (...args: never[]) => unknown;
const arrayMethods: Record<string, CapturedNative | undefined> = Object.create(null);
const names = ownNames(arrayPrototype);
for (let index = 0; index < names.length; index++) {
  const name = names[index]!;
  const value = ownValue(arrayPrototype, name);
  if (typeof value === 'function' && nativeApply(functionText, value, []) === `function ${name}() { [native code] }`) {
    arrayMethods[name] = value as CapturedNative;
  }
}
const iteratorMethod = ownValue(arrayPrototype, iterator);
const nativeIterator = typeof iteratorMethod === 'function' &&
  nativeApply(functionText, iteratorMethod, []) === 'function values() { [native code] }';
const iteratorPrototype = nativeIterator ? prototypeOf(nativeApply(iteratorMethod, [], [])) : null;
const iteratorNext = iteratorPrototype === null ? undefined : ownValue(iteratorPrototype, 'next');
const nativeNext = typeof iteratorNext === 'function' &&
  nativeApply(functionText, iteratorNext, []) === 'function next() { [native code] }';

/** Internal snapshots must not dispatch array methods or constructor hooks. */
export function copyListItems<T>(items: readonly T[]): T[] {
  const copy = arrayMethods.toSpliced;
  if (copy !== undefined) return nativeApply(copy, items, [0, 0]) as T[];
  // Older hosts still copy own data properties, bypassing inherited setters.
  const result: T[] = [];
  const property = createObject(null) as PropertyDescriptor;
  property.writable = property.enumerable = property.configurable = true;
  for (let index = 0; index < items.length; index++) {
    property.value = items[index]; defineOwn(result, index, property);
  }
  return result;
}

function nativeOperations(operations: readonly string[], guards: readonly string[]): boolean {
  if (operations.length === 0 && guards.length === 0) return true;
  if (prototypeOf(arrayPrototype) !== objectPrototype || prototypeOf(objectPrototype) !== null) return false;
  for (let index = 0; index < operations.length; index++) {
    const name = operations[index]!;
    const expected = arrayMethods[name];
    if (expected === undefined || ownValue(arrayPrototype, name) !== expected) return false;
  }
  for (let index = 0; index < guards.length; index++) {
    const guard = guards[index]!;
    if (guard === 'iterator') {
      if (!nativeIterator || !nativeNext || ownValue(arrayPrototype, iterator) !== iteratorMethod ||
          ownValue(iteratorPrototype!, 'next') !== iteratorNext) return false;
    } else if (guard === 'species') {
      if (!nativeSpecies || ownValue(realm, 'Array') !== arrayConstructor ||
          ownValue(arrayPrototype, 'constructor') !== arrayConstructor) return false;
      const current = ownDescriptor(arrayConstructor, species);
      if (current === undefined || ownValue(current, 'get') !== speciesGet || ownValue(current, 'set') !== speciesSet ||
          nativeApply(hasOwn, current, ['value'])) return false;
    } else if (guard === 'spreadable') {
      if (ownDescriptor(arrayPrototype, spreadable) !== undefined || ownDescriptor(objectPrototype, spreadable) !== undefined) return false;
    } else return false;
  }
  return true;
}

export function createListProvenance(): ListProvenance { return { valid: true }; }

/** Check before execution; a failed/throwing operation may have exposed rows. */
export function evaluateListOperation<T>(
  provenance: ListProvenance,
  operations: readonly string[],
  guards: readonly string[],
  fresh: boolean,
  evaluate: () => T,
): T {
  const previouslyValid = provenance.valid;
  provenance.valid = false;
  const eligible = (fresh || previouslyValid) && nativeOperations(operations, guards);
  const result = evaluate();
  // Failed guards remain sticky until a closed, independent fresh producer.
  provenance.valid = eligible;
  return result;
}
