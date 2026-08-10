export const profile = { name: 'Ada', visits: 0 };

export function visit(): void {
  profile.visits++;
}

export function rename(next: string): void {
  profile.name = next;
}
