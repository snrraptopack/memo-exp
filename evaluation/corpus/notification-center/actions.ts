import { center } from './state';

export function notify(message: string): void {
  center.notices.push({ id: center.nextId++, message, read: false });
}

export function markFirstRead(): void {
  const first = center.notices[0];
  if (first) first.read = true;
}

export function dismissFirst(): void {
  center.notices.shift();
}
