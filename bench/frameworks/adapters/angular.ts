/**
 * @file angular.ts
 * Defines a zoneless Angular component using Signals, computed state, and @for.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  signal,
} from '@angular/core';
import type { BenchMode, BenchScenario } from '../contract';
import {
  makeSnapshot,
  mutatePlain,
  remaining,
  updateImmutable,
  type Snapshot,
} from '../model';
import { AngularRow } from './angular-row';

@Component({
  selector: 'bench-root',
  standalone: true,
  imports: [AngularRow],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './angular.html',
})
export class AngularApp {
  readonly mode = signal<BenchMode>('reactive');
  readonly reactiveSnapshot = signal<Snapshot>(makeSnapshot(0));
  readonly forcedRevision = signal(0);
  forcedSnapshot = makeSnapshot(0);

  readonly visible = computed(() => {
    if (this.mode() === 'forced') void this.forcedRevision();
    return this.mode() === 'forced' ? this.forcedSnapshot : this.reactiveSnapshot();
  });

  readonly remaining = computed(() => {
    if (this.mode() === 'forced') void this.forcedRevision();
    return remaining(this.mode() === 'forced' ? this.forcedSnapshot : this.reactiveSnapshot());
  });

  reset(count: number, mode: BenchMode): void {
    this.mode.set(mode);
    this.forcedSnapshot = makeSnapshot(count);
    this.reactiveSnapshot.set(makeSnapshot(count));
    this.forcedRevision.update((value) => value + 1);
  }

  run(scenario: BenchScenario): void {
    if (this.mode() === 'forced') {
      mutatePlain(this.forcedSnapshot, scenario);
      this.forcedRevision.update((value) => value + 1);
    } else {
      this.reactiveSnapshot.update((snapshot) => updateImmutable(snapshot, scenario));
    }
  }
}

