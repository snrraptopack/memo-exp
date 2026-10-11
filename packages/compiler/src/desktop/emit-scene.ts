/** Emit retained scene factories without turning inline JSX into state scopes. */
import type * as t from '../ast/compiler-types';
import * as b from '../ast/factory';
import { valueExpression, type DesktopScene } from './lower-scene';

interface EmitOptions {
  id: string;
  stylesheets: unknown;
  stylesheet?: string;
  mount: t.Identifier;
  define: t.Identifier;
  fresh(name: string): t.Identifier;
  templates: t.Statement[];
  modules: readonly string[];
  lexical?: boolean;
  receive?: t.Expression;
  prepare?: t.Expression;
  lifecycle?: readonly t.ObjectProperty[];
}

interface EmittedScene {
  template: t.Identifier;
  setup: t.Statement[];
  fragmentTemplates: t.Identifier[];
  dependencies: string[];
  eventsUsed: boolean;
  scopesUsed: boolean;
  mount: t.CallExpression;
}

export function emitDesktopScene(scene: DesktopScene, options: EmitOptions): EmittedScene {
  const template = options.fresh('__desktopTemplate');
  options.templates.push(
    b.variableDeclaration('const', [
      b.variableDeclarator(
        template,
        valueExpression({
          id: options.id,
          nodes: scene.nodes,
          slots: scene.slots,
          events: scene.events,
          stylesheets: options.stylesheets,
          ...(options.stylesheet ? { stylesheet: options.stylesheet } : {}),
        }),
      ),
    ]),
  );

  const setup: t.Statement[] = [];
  const fragmentTemplates: t.Identifier[] = [];
  const dependencies = new Set(scene.componentNames);
  let eventsUsed = scene.handlers.length > 0;
  let scopesUsed = false;

  for (const fragment of scene.fragments) {
    const envelope = options.fresh('__desktopFragmentProps');
    const next = options.fresh('__desktopFragmentNext');
    const values = (props: t.Identifier) =>
      b.memberExpression(b.memberExpression(props, b.identifier('scope')), b.identifier('values'));
    const captureSetup = fragment.captures.map((capture, index) =>
      b.variableDeclaration('let', [
        b.variableDeclarator(
          capture,
          b.memberExpression(values(envelope), b.numericLiteral(index), true),
        ),
      ]),
    );
    const receive = fragment.captures.length
      ? b.arrowFunctionExpression(
          [next],
          b.blockStatement(
            fragment.captures.map((capture, index) =>
              b.expressionStatement(
                b.assignmentExpression(
                  '=',
                  capture,
                  b.memberExpression(values(next), b.numericLiteral(index), true),
                ),
              ),
            ),
          ),
        )
      : undefined;
    const emitted = emitDesktopScene(fragment.scene, {
      ...options,
      id: `${options.id}/${fragment.component.name}`,
      lexical: true,
      receive,
      prepare: undefined,
      lifecycle: undefined,
    });

    // Factories live inside the authored closure. Their templates live at module
    // scope so installation never evaluates an inactive branch or row binding.
    setup.push(
      b.variableDeclaration('const', [
        b.variableDeclarator(
          fragment.component,
          b.arrowFunctionExpression(
            [envelope],
            b.blockStatement([...captureSetup, ...emitted.setup, b.returnStatement(emitted.mount)]),
          ),
        ),
      ]),
    );
    setup.push(
      b.expressionStatement(
        b.callExpression(options.define, [
          fragment.component,
          emitted.template,
          b.arrowFunctionExpression([], b.arrayExpression(emitted.dependencies.map(b.identifier))),
          b.arrayExpression(emitted.fragmentTemplates),
          valueExpression(options.modules),
        ]),
      ),
    );
    dependencies.delete(fragment.component.name);
    for (const dependency of emitted.dependencies) dependencies.add(dependency);
    fragmentTemplates.push(emitted.template, ...emitted.fragmentTemplates);
    eventsUsed ||= emitted.eventsUsed;
    scopesUsed ||= fragment.captures.length > 0 || emitted.scopesUsed;
  }

  const properties: t.ObjectProperty[] = [];
  properties.push(b.objectProperty(b.identifier('modules'), valueExpression(options.modules)));
  if (options.lexical)
    properties.push(b.objectProperty(b.identifier('lexical'), b.booleanLiteral(true)));
  for (const [name, entries] of [
    ['children', scene.children],
    ['regions', scene.regions],
    ['lists', scene.lists],
    ['refs', scene.refs],
  ] as const) {
    if (entries.length)
      properties.push(b.objectProperty(b.identifier(name), b.arrayExpression(entries)));
  }
  if (scene.componentNames.length)
    properties.push(
      b.objectProperty(
        b.identifier('components'),
        b.arrayExpression(scene.componentNames.map(b.identifier)),
      ),
    );
  if (options.receive)
    properties.push(b.objectProperty(b.identifier('receiveProps'), options.receive));
  if (options.prepare) properties.push(b.objectProperty(b.identifier('prepare'), options.prepare));
  properties.push(...(options.lifecycle ?? []));

  return {
    template,
    setup,
    fragmentTemplates,
    dependencies: [...dependencies],
    eventsUsed,
    scopesUsed,
    mount: b.callExpression(options.mount, [
      template,
      b.arrayExpression(scene.bindings),
      b.arrayExpression(scene.handlers),
      b.objectExpression(properties),
    ]),
  };
}
