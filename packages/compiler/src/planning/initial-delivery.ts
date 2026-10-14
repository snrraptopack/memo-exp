/** Delivery metadata shared by build orchestration without importing an emitter. */
export interface InitialDelivery {
  readonly key: string;
  /** Absent when the same server factory must evaluate request data. */
  readonly html?: string;
  readonly target: string;
  readonly browser: 'none' | 'bindings';
}
