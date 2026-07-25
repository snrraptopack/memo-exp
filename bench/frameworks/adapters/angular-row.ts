/**
 * @file angular-row.ts
 * Defines the normal OnPush Angular row used by the Signals benchmark.
 */
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Todo } from '../model';

@Component({
  selector: 'bench-todo-row',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './angular-row.html',
})
export class AngularRow {
  readonly todo = input.required<Todo>();
  readonly forcedRevision = input(0);
}

