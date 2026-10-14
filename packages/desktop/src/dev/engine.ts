/** Private, pinned module shared by the launcher and every application revision. */
export * from '../runtime/entry';
export * from '../runtime/view';

import { PublicationClient } from '../host/client';
import { NativeApplication } from '../runtime/application';
import { createMountAdapter } from '../runtime/mount';
import { installNativeMount } from '../runtime/entry';
import { dispatchNativeEvent } from '../runtime/dispatch';
import { replaceStylesheets, type StylesheetSource } from '../runtime/stylesheets';
import { connectNativeHost } from '@memoized-dom/desktop/internal-host';

/** Transport, dispatch and acceptance are launcher concerns, not authored APIs. */
export function openApplication(executable: string, target: string, headless = false) {
  const reportError = (error: unknown) => console.error(error);
  let adapter: ReturnType<typeof createMountAdapter>;
  const client = new PublicationClient(connectNativeHost({
    executable,
    args: headless ? ['--headless'] : ['--window', '--mount-target', target],
  }), {
    requireReady: !headless,
    dispatch: event => dispatchNativeEvent(adapter.view(), event, reportError),
  });
  const application = new NativeApplication(client, {
    scheduleFrame: null,
    visible: () => true,
    reportError,
  });
  adapter = createMountAdapter(application, target, reportError);
  let mounted: ReturnType<typeof adapter.mount> | undefined;
  let lastComponent: (() => unknown) | undefined;
  const loadedRoots = new WeakMap<object, () => unknown>();
  const uninstall = installNativeMount({
    ...adapter,
    mount(target, component) {
      lastComponent = component;
      mounted = adapter.mount(target, component);
      return mounted;
    },
  });

  // Replacements use accepted retirement and the same connection/core. They
  // are whole-root replacements, not a claim of component-preserving HMR.
  return {
    async replace(
      css: readonly StylesheetSource[],
      load?: () => Promise<unknown>
    ) {
      await client.whenReady();
      mounted?.unmount();
      await adapter.settled();
      replaceStylesheets(css);
      if (load) {
        const module = await load();
        if (typeof module !== 'object' || module === null) {
          throw new Error('The application loader must return its ESM module namespace');
        }
        if (!mounted?.mounted) {
          const component = loadedRoots.get(module);
          if (!component) {
            throw new Error('The application entry did not mount a compiled root');
          }
          mounted = adapter.mount(target, component);
          lastComponent = component;
        } else if (lastComponent) {
          loadedRoots.set(module, lastComponent);
        }
      } else if (lastComponent) {
        mounted = adapter.mount(target, lastComponent);
      }
      await adapter.settled();
    },
    close() {
      uninstall();
      application.close();
    },
    onClose: (listener: (error: Error) => void) => client.onClose(listener),
    adapter,
  };
}
