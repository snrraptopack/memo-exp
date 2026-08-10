import { center } from './state';

export const unread = center.notices.filter((notice) => !notice.read).length;
export const totalNotices = center.notices.length;
