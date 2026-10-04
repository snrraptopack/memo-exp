/** Browser placement facts derived from the initial-content proof. */
export interface InitialBrowserRoot {
  readonly target: string;
  readonly component: string;
  readonly returnSite: string;
  readonly regions: readonly { readonly id: number; readonly site: string }[];
}
