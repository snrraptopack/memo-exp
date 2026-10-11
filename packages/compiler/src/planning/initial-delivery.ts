/** Linked initial-content delivery facts; target emitters decide how to apply them. */
export interface InitialDelivery {
  readonly key: string;
  /** Absent when a server factory must evaluate request data. */
  readonly html?: string;
  readonly target: string;
  readonly browser: 'none' | 'bindings';
}
