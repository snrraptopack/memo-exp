import { spawn } from 'node:child_process';
import { pnpmVersion, upstream } from './pin';

export async function command(executable: string, args: string[], cwd: string,
  env: NodeJS.ProcessEnv = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd, env: { ...process.env, ...env }, stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? resolve()
      : reject(new Error(`${executable} ${args.join(' ')} failed (${signal ?? code})`)));
  });
}
export function pnpm(args: string[], cwd = upstream): Promise<void> {
  // Install this selected workspace explicitly; pnpm's pre-run auto-install
  // would instead request unrelated root workspace packages absent from it.
  return command(process.execPath, ['x', `pnpm@${pnpmVersion}`, ...args], cwd, {
    CI: 'true', pnpm_config_verify_deps_before_run: 'false', PLAYWRIGHT_SKIP_BROWSER_GC: '1',
  });
}
