/** Private build-selected implementation of the ordinary mount call. */
import { rootFactoryStore } from '@memoized-dom/runtime/core';

import { HostError } from '../host/protocol';
import type { NativeApplication } from './application';
import type { NativeRootDefinition, NativeView } from './view';

export interface NativeMountHost {
  readonly id: string;
  readonly isConnected: boolean;
}

export interface NativeMountedApplication {
  readonly host: NativeMountHost;
  readonly rootId: string;
  readonly mounted: boolean;
  unmount(): void;
}

/**
 * A launcher binds the connection once before evaluating the authored entry.
 * This is host configuration, not another application mounting API. Completion
 * is observable privately for launch/error handling; mount/unmount remain sync.
 */
export function createMountAdapter(
  application: NativeApplication,
  hostId: string,
  reportError: (error: unknown) => void
) {
  let occupied = false;
  let generation = 0;
  let currentView: NativeView | undefined;
  let completion: Promise<unknown> = Promise.resolve();
  const acceptedTemplates = new Set<string>();

  function mount(target: string, component: (...args: never[]) => unknown): NativeMountedApplication {
    if (target !== hostId) {
      throw new HostError('missingMountTarget', `Mount target '#${target}' was not found`);
    }

    const definition = rootFactoryStore<NativeRootDefinition>().get(component);

    if (definition?.kind !== 'native') {
      throw new HostError('uncompiledRoot', 'Mount received a component that is not a compiled native root');
    }

    if (occupied) {
      throw new HostError('occupiedMountTarget', 'Mount target already owns an application');
    }

    occupied = true;
    const owner = { id: definition.id, generation: ++generation };
    let requested = true;
    let retiring = false;
    let connected = false;
    let view!: NativeView;

    const release = () => {
      requested = false;
      connected = false;
      occupied = false;
      if (currentView === view) {
        currentView = undefined;
      }
    };

    let candidate;

    try {
      candidate = application.prepare(() => {
        view = definition.create({ application, owner, parent: null, reportError });
        return view;
      }, {
        accepted() {
          acceptedTemplates.add(view.template.key);
          connected = true;
          view.acceptInitial();
        },
        activated() {
          view.activateUpdates();
        },
        disposed: release
      });
    } catch (error) {
      release();
      throw error;
    }

    currentView = view;
    const publication = view.initialPublication;
    const accepted = candidate.publish(acceptedTemplates.has(view.template.key)
      ? { operations: publication.operations }
      : publication);
    completion = accepted;
    void accepted.catch(reportError);

    return {
      host: {
        id: hostId,
        get isConnected() { return connected; }
      },
      rootId: definition.id,
      get mounted() { return requested && !application.isClosed; },
      unmount() {
        if (!requested || retiring) {
          return;
        }

        retiring = true;
        // Retirement follows initial acceptance even if unmount was requested
        // before the native reply. A refused retire retains the accepted owner.
        const retired = accepted.then(() => candidate.retire({
          operations: [{ op: 'retire', owner }]
        }));
        completion = retired;
        void retired.catch(error => {
          retiring = false;
          reportError(error);
        });
      }
    };
  }

  return {
    mount,
    settled: () => completion,
    view: () => currentView
  };
}
