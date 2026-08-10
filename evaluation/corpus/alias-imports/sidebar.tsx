import { profile as account, rename as setName } from './state';

export function Sidebar() {
  return <button onClick={() => setName('Grace')}>{account.name}</button>;
}
