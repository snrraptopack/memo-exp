import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { compileModules } from '../packages/compiler/src/linker';

describe('assimilation lab source compile', () => {
  it('compiles every MMD lab module', () => {
    const src = join(__dirname, '..', 'assimilation', 'mmd', 'src');
    const modules: Record<string, string> = {};
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) { walk(path); continue; }
        if (!/\.tsx?$/.test(name)) continue;
        const key = './' + relative(src, path).split('\\').join('/');
        modules[key] = readFileSync(path, 'utf8');
      }
    };
    walk(src);
    const output = compileModules(modules);
    expect(Object.keys(output).length).toBe(Object.keys(modules).length);
  });
});
