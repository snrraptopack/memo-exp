import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveAdapterOptions } from '../src/options';
import {
  isServerConfigFile,
  serverConfigDeclarationFile,
  writeServerConfigDeclaration,
} from '../src/server-config';

let fixture: string | undefined;

afterEach(async () => {
  if (fixture !== undefined) {
    await rm(fixture, { recursive: true, force: true });
    fixture = undefined;
  }
});

describe('server config type registration', () => {
  it('writes one package augmentation for the conventional server contract', async () => {
    fixture = await mkdtemp(resolve(tmpdir(), 'memoized-dom-server-config-'));
    const configDirectory = resolve(fixture, 'src/server/config');
    const configFile = resolve(configDirectory, 'index.ts');
    await mkdir(configDirectory, { recursive: true });
    await writeFile(configFile, `
      export interface ServerTypes {
        locals: { requestId: string };
        platform: { region: string };
      }
    `);
    const options = resolveAdapterOptions({
      clientEntry: 'src/main.ts',
      server: 'src/server',
    });

    await expect(writeServerConfigDeclaration(fixture, options))
      .resolves.toBe(configFile.replaceAll('\\', '/'));
    const declaration = await readFile(
      serverConfigDeclarationFile(fixture),
      'utf8',
    );
    expect(declaration).toContain(
      'ServerTypes as __MemoizedDomServerTypes',
    );
    expect(declaration).toContain(
      "declare module '@memoized-dom/server/router'",
    );
    expect(declaration).toContain(
      'application: __MemoizedDomServerTypes',
    );
    expect(declaration).toContain(
      "declare module '@memoized-dom/router'",
    );
    expect(declaration).toContain('interface RoutedTypeRegistry');
    expect(isServerConfigFile(fixture, configFile, options)).toBe(true);
  });

  it('removes a stale registration when the config entry is removed', async () => {
    fixture = await mkdtemp(resolve(tmpdir(), 'memoized-dom-server-config-'));
    const configDirectory = resolve(fixture, 'server/config');
    const configFile = resolve(configDirectory, 'index.ts');
    await mkdir(configDirectory, { recursive: true });
    await writeFile(configFile, 'export interface ServerTypes { locals: {} }');
    const options = resolveAdapterOptions({ clientEntry: 'main.ts' });
    await writeServerConfigDeclaration(fixture, options);
    await rm(configFile);

    await expect(writeServerConfigDeclaration(fixture, options))
      .resolves.toBeNull();
    await expect(readFile(serverConfigDeclarationFile(fixture), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
});
