import { dismissFirst, markFirstRead, notify } from './actions';
import { totalNotices, unread } from './derived';

export function NotificationCenter() {
  return <aside><button onClick={() => notify('saved')}>notify</button><button onClick={() => markFirstRead()}>read</button><button onClick={() => dismissFirst()}>dismiss</button><output>{unread}:{totalNotices}</output></aside>;
}
