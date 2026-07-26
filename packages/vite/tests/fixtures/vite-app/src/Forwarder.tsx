/**
 * Forwards a reactive prop so the linker must preserve its defining origin.
 */
import { Panel } from './Panel';

export function Forwarder(props: { selected: Set<number> }) {
  return <Panel selected={props.selected} />;
}
