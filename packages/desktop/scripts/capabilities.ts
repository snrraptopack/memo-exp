/** Regenerate package-local projections from the one Rust tag contract. */
import { resolve } from 'node:path';

const directory = resolve(import.meta.dirname, '..');
const result = Bun.spawn(['cargo', 'run', '--locked', '--', '--capabilities'], {
  cwd: resolve(directory, 'rust'),
  stdout: 'pipe',
  stderr: 'inherit',
});
const source = await new Response(result.stdout).text();

if ((await result.exited) !== 0) {
  throw new Error('Native capability generation failed');
}

const projection: unknown = JSON.parse(source);
const contents = `${JSON.stringify(projection, null, 2)}\n`;

// Each package must build without reading its sibling's source tree. These are
// generated artifacts, not separately maintained capability registries. Rust
// checks both against tags.rs so neither consumer can silently drift.
const destinations = [
  resolve(directory, 'src/scene/capabilities.json'),
  resolve(directory, '../compiler/src/desktop/capabilities.json'),
];

for (const destination of destinations) {
  await Bun.write(destination, contents);
}
