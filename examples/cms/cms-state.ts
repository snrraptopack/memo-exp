/**
 * @file cms-state.ts
 * Module-level state & R32 module-level effect for the CMS Content Studio.
 */

export type ContainerTag = 'section' | 'article' | 'aside';
export type ViewTab = 'preview' | 'code' | 'raw';

export let rawMarkup = `<h2>🚀 Memoized DOM Content Studio</h2>
<p>This editor demonstrates <strong>R29 (JSX Aliases)</strong>, <strong>R30 (Dynamic Tags)</strong>, <strong>R31 (Reactive innerHTML)</strong>, and <strong>R32 (Module-level Effects)</strong>.</p>
<ul>
  <li>Fast compilation with static access tables</li>
  <li>Direct element innerHTML property updates</li>
  <li>Module-level reactive effects outside components</li>
</ul>`;

export let containerTag: ContainerTag = 'section';
export let activeTab: ViewTab = 'preview';
export let autoSaveLog = 'Initializing...';

// R32: Module-level effect outside any component body!
effect(() => {
  autoSaveLog = `Auto-saved at ${new Date().toLocaleTimeString()} (${rawMarkup.length} bytes, tag: <${containerTag}>)`;
});

export function setRawMarkup(text: string) {
  rawMarkup = text;
}

export function setContainerTag(tag: ContainerTag) {
  containerTag = tag;
}

export function setActiveTab(tab: ViewTab) {
  activeTab = tab;
}
