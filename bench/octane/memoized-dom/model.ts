// Data and shuffle algorithms ported from the pinned Octane js-framework
// fixture (MIT, Dominic Gannaway). Keep its random stream and row payloads.
export interface Row { id: number; label: string }
const adjectives = ['pretty', 'large', 'big', 'small', 'tall', 'short', 'long',
  'handsome', 'plain', 'quaint', 'clean', 'elegant', 'easy', 'angry', 'crazy',
  'helpful', 'mushy', 'odd', 'unsightly', 'adorable', 'important', 'inexpensive',
  'cheap', 'expensive', 'fancy'];
const colours = ['red', 'yellow', 'blue', 'green', 'pink', 'brown', 'purple',
  'brown', 'white', 'black', 'orange'];
const nouns = ['table', 'chair', 'house', 'bbq', 'desk', 'car', 'pony', 'cookie',
  'sandwich', 'burger', 'pizza', 'mouse', 'keyboard'];
let nextId = 1;
export function buildData(count: number): Row[] {
  // oxlint-disable-next-line unicorn/no-new-array -- match upstream allocation work
  const data = new Array<Row>(count);
  for (let i = 0; i < count; i++) data[i] = {
    id: nextId++,
    label: adjectives[(Math.random() * adjectives.length) | 0] + ' ' +
      colours[(Math.random() * colours.length) | 0] + ' ' +
      nouns[(Math.random() * nouns.length) | 0],
  };
  return data;
}
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
const shuffleSeeds = mulberry32(42);
export function shuffleRows(rows: Row[]): Row[] {
  const random = mulberry32((shuffleSeeds() * 4294967296) >>> 0);
  const result = rows.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = (random() * (i + 1)) | 0;
    const previous = result[i]!;
    result[i] = result[j]!;
    result[j] = previous;
  }
  return result;
}
export function updateRows(rows: Row[]): Row[] {
  const result = rows.slice();
  for (let i = 0; i < result.length; i += 10) {
    const row = result[i]!;
    result[i] = { id: row.id, label: row.label + ' !!!' };
  }
  return result;
}
export function swapRows(rows: Row[]): Row[] {
  if (rows.length <= 998) return rows;
  const result = rows.slice();
  const previous = result[1]!;
  result[1] = result[998]!;
  result[998] = previous;
  return result;
}
export function removeRow(rows: Row[], row: Row): Row[] {
  const result = rows.slice();
  result.splice(result.indexOf(row), 1);
  return result;
}
