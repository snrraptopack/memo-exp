import { bumpPrimary, bumpSecondary, primary, secondary, showingPrimary, toggle } from './state';

export function Branching() {
  return <section><button onClick={() => toggle()}>toggle</button><button onClick={() => bumpPrimary()}>primary</button><button onClick={() => bumpSecondary()}>secondary</button><output>{showingPrimary ? primary : secondary}</output></section>;
}
