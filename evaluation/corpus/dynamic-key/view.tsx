import { settings, updateSetting } from './state';

export function Settings() {
  return <button onClick={() => updateSetting('theme', 'light')}>{settings.theme}:{settings.locale}</button>;
}
