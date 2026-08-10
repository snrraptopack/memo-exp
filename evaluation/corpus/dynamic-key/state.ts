export const settings: Record<string, string> = { theme: 'dark', locale: 'en' };

export function updateSetting(key: string, value: string): void {
  settings[key] = value;
}
