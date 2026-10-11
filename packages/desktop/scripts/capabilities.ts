/** Regenerate the compiler/runtime projection after changing Rust tag contracts. */
import { resolve } from 'node:path';

const directory = resolve(import.meta.dirname, '..');
const result = Bun.spawn(['cargo', 'run', '--locked', '--', '--capabilities'], {
  cwd: resolve(directory, 'rust'),
  stdout: 'pipe',
  stderr: 'inherit',
});
const source = await new Response(result.stdout).text();
if ((await result.exited) !== 0) throw new Error('Native capability generation failed');
const projection: unknown = JSON.parse(source);
await Bun.write(
  resolve(directory, 'src/scene/capabilities.json'),
  `${JSON.stringify(projection, null, 2)}\n`,
);
