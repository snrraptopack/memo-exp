import puppeteer from 'puppeteer-core';
import { resolve } from 'node:path';
import type { SceneSnapshot, SceneTemplate } from '@memoized-dom/desktop';

/** Compare the same authored scene/CSS with Chromium's real layout engine. */
export async function compareBrowserLayout(
  snapshot: SceneSnapshot,
  templates: ReadonlyMap<string, SceneTemplate>,
) {
  const native = snapshot.renderer!;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH ??
      (process.platform === 'win32'
        ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
        : '/usr/bin/chromium'),
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: Math.round(native.width),
      height: Math.round(native.scroll?.viewport ?? native.height),
    });
    const css = await Bun.file(resolve(import.meta.dirname, '../todo/todo.css')).text();
    await page.setContent('<html><head></head><body></body></html>');
    const bounds = await page.evaluate(
      ({ snapshot, templates, css }) => {
        const style = document.createElement('style');
        // GPUI has border-box sizing, inherited control typography, and an overlay
        // scroll viewport. Normalize browser UA defaults before comparing geometry.
        style.textContent =
          'html,body{margin:0;scrollbar-width:none}*{box-sizing:border-box}button,input{font:inherit;line-height:inherit}' +
          css;
        document.head.append(style);
        const records = new Map(
          snapshot.instances.map((instance) => [instance.handle.id, instance]),
        );
        const definitions = new Map(templates);
        // Reconstruct the accepted scene rather than writing a second fixture.
        // Template structure and live slot values must produce the same content.
        const render = (id: number): DocumentFragment => {
          const instance = records.get(id)!;
          const template = definitions.get(instance.template)!;
          const result = document.createDocumentFragment();
          const nodes: Node[] = template.nodes.map((node, index) => {
            if (node.kind === 'text')
              return document.createTextNode(instance.texts[index] ?? node.text);
            if (node.kind === 'region') return document.createComment('component region');
            const element = document.createElement(node.tag);
            for (const [name, value] of Object.entries(node.attributes ?? {}))
              element.setAttribute(name, value);
            for (const declaration of node.style ?? [])
              element.style.setProperty(declaration.property, declaration.value);
            if (element instanceof HTMLInputElement) element.value = instance.texts[index] ?? '';
            return element;
          });
          template.nodes.forEach((node, index) => {
            if (node.parent !== null) nodes[node.parent]!.appendChild(nodes[index]!);
          });
          template.nodes.forEach((node, index) => {
            if (node.parent === null) result.appendChild(nodes[index]!);
          });
          template.nodes.forEach((node, index) => {
            if (node.kind !== 'region') return;
            const children = snapshot.instances.filter(
              (child) => child.attach_to?.handle.id === id && child.attach_to.node === index,
            );
            const order = instance.orders?.[String(index)];
            children.sort((a, b) =>
              order
                ? order.findIndex((item) => item.id === a.handle.id) -
                  order.findIndex((item) => item.id === b.handle.id)
                : 0,
            );
            for (const child of children) {
              // A region is an insertion anchor, not a layout container. Adding
              // a wrapper here would change flex/grid behavior in the comparison.
              (nodes[index] as Comment).before(render(child.handle.id));
            }
          });
          return result;
        };
        for (const instance of snapshot.instances.filter((instance) => !instance.attach_to))
          document.body.append(render(instance.handle.id));
        return Object.fromEntries(
          ['todo-workspace', 'stat-total', 'stat-active', 'stat-done', 'new-task', 'add-task'].map(
            (id) => {
              const box = document.getElementById(id)!.getBoundingClientRect();
              return [id, { x: box.x, y: box.y, width: box.width, height: box.height }];
            },
          ),
        );
      },
      { snapshot, templates: [...templates], css },
    );
    const find = (id: string) => native.boxes.find((box) => box.id === id)!;
    // Allow layout rounding while keeping alignment/column errors observable.
    // Font rasterization and intrinsic text measurements are not identical.
    for (const id of ['todo-workspace', 'stat-total', 'stat-active', 'stat-done']) {
      const expected = bounds[id]!;
      const actual = find(id);
      if (Math.abs(actual.x - expected.x) > 2 || Math.abs(actual.width - expected.width) > 2)
        throw new Error(
          `Native/browser CSS geometry differs for ${id}: native ${actual.x}/${actual.width}, browser ${expected.x}/${expected.width}`,
        );
    }
    const browserWrap =
      bounds['add-task']!.y > bounds['new-task']!.y + bounds['new-task']!.height / 2;
    const nativeWrap = find('add-task').y > find('new-task').y + find('new-task').height / 2;
    if (browserWrap !== nativeWrap)
      throw new Error('Native flex wrapping differs from browser CSS');
    return {
      width: native.width,
      workspaceWidth: bounds['todo-workspace']!.width,
      wrapped: browserWrap,
    };
  } finally {
    await browser.close();
  }
}
