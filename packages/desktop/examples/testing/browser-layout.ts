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
    const { bounds, rowGeometry, selectorChecks } = await page.evaluate(
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
        const authoredElements = new Map<string, HTMLElement>();
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
            authoredElements.set(`${id}:${index}`, element);
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
        const focused = snapshot.renderer?.focused;
        if (focused) authoredElements.get(`${focused.handle.id}:${focused.node}`)?.focus();

        // Compare the accepted native cascade with Chromium after composing the
        // same region forest. A standalone probe resolves CSS color/unit syntax
        // without copying our selector or specificity implementation.
        const probe = document.createElement('div');
        probe.style.position = 'absolute';
        probe.style.visibility = 'hidden';
        document.body.append(probe);
        let selectorChecks = 0;
        for (const instance of snapshot.instances) {
          const template = definitions.get(instance.template)!;
          for (const [source, node] of template.nodes.entries()) {
            if (node.kind !== 'element') continue;
            const element = authoredElements.get(`${instance.handle.id}:${source}`)!;
            if (!element.matches('.task-row, .task-content, .task-title, .row-note')) continue;
            const isFocused = focused?.handle.id === instance.handle.id && focused.node === source;
            const state = isFocused ? 2 : 0;
            const accepted = instance.styles?.[source]?.states[state];
            if (!accepted) throw new Error('Native snapshot omitted accepted CSS');
            const computed = getComputedStyle(element);
            const properties = [
              'display', 'flex-direction', 'padding-left',
              'font-size', 'font-weight', 'border-color',
            ];
            for (const property of properties) {
              const value = accepted[property];
              if (value === undefined) continue;
              probe.style.setProperty(property, value);
              const expected = getComputedStyle(probe).getPropertyValue(property);
              const actual = computed.getPropertyValue(property);
              probe.style.removeProperty(property);
              if (actual !== expected) {
                throw new Error(
                  `CSS cascade differs for ${instance.handle.id}:${source} ${property}: native ${value}, browser ${actual}`,
                );
              }
              selectorChecks++;
            }
          }
        }
        probe.remove();
        if (selectorChecks === 0)
          throw new Error('Cross-fragment CSS comparison checked no declarations');
        const rowGeometry = snapshot.renderer!.boxes
          .filter(box => box.tag === 'article')
          .map(box => {
            const element = authoredElements.get(`${box.handle.id}:${box.source}`)!;
            const rect = element.getBoundingClientRect();
            return {
              native: { x: box.x, width: box.width },
              browser: { x: rect.x, width: rect.width },
            };
          });
        const ids = ['todo-workspace', 'stat-total', 'stat-active', 'stat-done', 'new-task', 'add-task'];
        const bounds = Object.fromEntries(ids.map(id => {
          const box = document.getElementById(id)!.getBoundingClientRect();
          return [id, { x: box.x, y: box.y, width: box.width, height: box.height }];
        }));
        return { selectorChecks, rowGeometry, bounds };
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
    for (const row of rowGeometry) {
      if (
        Math.abs(row.native.x - row.browser.x) > 2 ||
        Math.abs(row.native.width - row.browser.width) > 2
      )
        throw new Error('Native row geometry differs from browser after matching fragment selectors');
    }
    return {
      width: native.width,
      workspaceWidth: bounds['todo-workspace']!.width,
      wrapped: browserWrap,
      selectorChecks,
    };
  } finally {
    await browser.close();
  }
}
