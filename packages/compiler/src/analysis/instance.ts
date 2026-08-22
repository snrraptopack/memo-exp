import type { NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import {
  isConstObjectState,
  isStoreObject,
  memberRootName,
  type Ctx,
} from '../context';
import {
  bindingNames,
  type LocalDerivation,
} from '../components/props';
import { jsxAttributeName } from '../jsx/attributes';
import { summarizeHelper } from '../helper-summaries';

interface LocalDerivationHelperSummary {
  reads: Set<string>;
  reason: string | null;
}

function localFunctionPath(
  componentPath: NodePath<t.FunctionDeclaration>,
  at: NodePath,
  name: string,
): NodePath<t.Function> | null {
  const binding = at.scope.getBinding(name);
  if (binding === undefined) return null;
  let candidate: NodePath | null = null;
  if (binding.path.isFunctionDeclaration()) {
    candidate = binding.path;
  } else if (binding.path.isVariableDeclarator()) {
    const init = binding.path.get('init');
    if (
      !Array.isArray(init) &&
      (init.isFunctionExpression() || init.isArrowFunctionExpression())
    ) {
      candidate = init;
    }
  }
  if (
    candidate === null ||
    candidate.findParent((parent) => parent.node === componentPath.node) ===
      null
  ) {
    return null;
  }
  return candidate as NodePath<t.Function>;
}

function summarizeLocalDerivationHelper(
  ctx: Ctx,
  componentPath: NodePath<t.FunctionDeclaration>,
  at: NodePath,
  name: string,
  reactiveBindings: Map<unknown, string>,
  cache: Map<t.Function, LocalDerivationHelperSummary>,
  visiting: Set<t.Function>,
): LocalDerivationHelperSummary | null {
  const functionPath = localFunctionPath(componentPath, at, name);
  if (functionPath === null) return null;
  const cached = cache.get(functionPath.node);
  if (cached !== undefined) return cached;
  if (visiting.has(functionPath.node)) {
    return {
      reads: new Set(),
      reason: `calls recursive local helper '${name}'`,
    };
  }

  const summary: LocalDerivationHelperSummary = {
    reads: new Set(),
    reason: null,
  };
  const fail = (message: string): void => {
    summary.reason ??= message;
  };
  const noteReactiveIdentifier = (path: NodePath): void => {
    if (!path.isIdentifier()) return;
    const binding = path.scope.getBinding(path.node.name);
    const source =
      binding === undefined ? undefined : reactiveBindings.get(binding);
    if (source !== undefined) summary.reads.add(source);
  };
  const noteReactiveMutation = (path: NodePath, node: t.Node): void => {
    const root = t.isIdentifier(node)
      ? node.name
      : t.isMemberExpression(node)
        ? memberRootName(node)
        : null;
    if (root === null) return;
    const binding = path.scope.getBinding(root);
    const source =
      binding === undefined ? undefined : reactiveBindings.get(binding);
    if (source !== undefined) {
      fail(`calls local helper '${name}' which writes reactive state '${source}'`);
    }
  };
  const noteCall = (callPath: NodePath<t.CallExpression>): void => {
    const callee = callPath.node.callee;
    if (!t.isIdentifier(callee)) return;
    const local = summarizeLocalDerivationHelper(
      ctx,
      componentPath,
      callPath,
      callee.name,
      reactiveBindings,
      cache,
      visiting,
    );
    if (local !== null) {
      for (const read of local.reads) summary.reads.add(read);
      if (local.reason !== null) fail(local.reason);
      return;
    }
    if (!ctx.helpers.has(callee.name) && !ctx.importedFunctions.has(callee.name)) {
      return;
    }
    const moduleSummary =
      ctx.importedFunctions.get(callee.name) ??
      summarizeHelper(ctx, callee.name);
    for (const read of moduleSummary.reads) summary.reads.add(read);
    if (
      moduleSummary.writes.size !== 0 ||
      moduleSummary.boundedWrites.size !== 0
    ) {
      fail(`calls helper '${callee.name}' which writes reactive state`);
    } else if (moduleSummary.unbounded && ctx.helpers.has(callee.name)) {
      fail(`calls recursive helper '${callee.name}' which cannot be analyzed`);
    }
  };

  visiting.add(functionPath.node);
  functionPath.traverse({
    Function(path) {
      const parent = path.parentPath;
      const executesNow =
        (parent.isCallExpression() || parent.isNewExpression()) &&
        parent.node.callee === path.node;
      if (!executesNow) {
        path.skip();
      }
    },
    ReferencedIdentifier(path) {
      noteReactiveIdentifier(path);
    },
    AssignmentExpression(path) {
      noteReactiveMutation(path, path.node.left);
    },
    UpdateExpression(path) {
      noteReactiveMutation(path, path.node.argument);
    },
    AwaitExpression() {
      fail(`calls async local helper '${name}'`);
    },
    YieldExpression() {
      fail(`calls yielding local helper '${name}'`);
    },
    CallExpression(path) {
      noteCall(path);
    },
  });
  if (summary.reads.size !== 0) {
    functionPath.traverse({
      Function(path) {
        const parent = path.parentPath;
        const participatesInCall =
          (parent.isCallExpression() || parent.isNewExpression()) &&
          (parent.node.callee === path.node ||
            parent.node.arguments.some((argument) => argument === path.node));
        if (!participatesInCall) path.skip();
      },
      ReferencedIdentifier(path) {
        noteReactiveIdentifier(path);
      },
      AssignmentExpression(path) {
        noteReactiveMutation(path, path.node.left);
      },
      UpdateExpression(path) {
        noteReactiveMutation(path, path.node.argument);
      },
      AwaitExpression() {
        fail(`calls async local helper '${name}'`);
      },
      YieldExpression() {
        fail(`calls yielding local helper '${name}'`);
      },
      CallExpression(path) {
        noteCall(path);
      },
    });
  }
  visiting.delete(functionPath.node);
  cache.set(functionPath.node, summary);
  return summary;
}

/** Collect mutable or store-like bindings owned by each component instance. */
export function scanInstanceState(ctx: Ctx): void {
  for (const [name, componentPath] of ctx.compPaths) {
    const variables = new Set<string>();
    for (const statement of componentPath.node.body.body) {
      if (!t.isVariableDeclaration(statement)) continue;
      if (
        statement.kind !== 'let' &&
        statement.kind !== 'var' &&
        statement.kind !== 'const'
      ) {
        continue;
      }
      for (const declaration of statement.declarations) {
        if (!t.isIdentifier(declaration.id)) continue;
        if (
          statement.kind === 'let' ||
          statement.kind === 'var' ||
          isStoreObject(declaration.init) ||
          isConstObjectState(declaration.init)
        ) {
          variables.add(declaration.id.name);
        }
      }
    }
    if (variables.size > 0) ctx.instanceState.set(name, variables);
  }
}

/**
 * Local bindings used as a JSX `ref={name}` sink hold external DOM nodes.
 * They are mutable references, not reactive state: assigning the binding is
 * the ref adapter's job, and field writes / receiver calls through the node
 * (`input.value = x`, `canvas.getContext('2d')`) mutate the outside world.
 * Treating those as reactive writes made every ref-using effect invalidate
 * its own owner, which re-marks the effect — a render cycle (see the
 * TelemetryCanvas cascade). Exclude them from instance state so neither the
 * write analyzers nor the reason-id system ever route through them.
 */
export function excludeRefBindings(ctx: Ctx): void {
  for (const [name, componentPath] of ctx.compPaths) {
    const state = ctx.instanceState.get(name);
    if (state === undefined || state.size === 0) continue;
    const refs = new Set<string>();
    componentPath.traverse({
      JSXAttribute(path) {
        if (jsxAttributeName(path.node.name) !== 'ref') return;
        const value = path.node.value;
        if (!t.isJSXExpressionContainer(value)) return;
        const expression = value.expression;
        if (t.isIdentifier(expression)) {
          refs.add(expression.name);
          return;
        }
        // ref={[a, b]} installs several refs in deterministic order
        if (t.isArrayExpression(expression)) {
          for (const element of expression.elements) {
            if (element !== null && t.isIdentifier(element)) {
              refs.add(element.name);
            }
          }
        }
      },
    });
    for (const ref of refs) state.delete(ref);
  }
}

/**
 * Discover ordered component-local const derivations. These replay in the
 * owning component update before guarded DOM setters.
 */
export function scanInstanceDerivations(ctx: Ctx): void {
  for (const [componentName, componentPath] of ctx.compPaths) {
    const reactiveBindings = new Map<unknown, string>();
    // Opaque roots ($fetch handles, external clients) change outside the
    // access table; consts derived from them must replay on every update or
    // their values freeze at factory time. Reading one qualifies a const as
    // a derivation exactly like a reactive read does.
    const opaqueRoots = ctx.opaqueBindings.get(componentName);
    const isOpaqueLocal = (name: string, at: NodePath): boolean => {
      if (opaqueRoots?.has(name) !== true) return false;
      const binding = at.scope.getBinding(name);
      return (
        binding !== undefined &&
        binding === componentPath.scope.getBinding(name)
      );
    };

    for (const name of ctx.componentProps.get(componentName)?.bindings ?? []) {
      const binding = componentPath.scope.getBinding(name);
      if (binding) reactiveBindings.set(binding, name);
    }
    for (const name of ctx.instanceState.get(componentName) ?? []) {
      const binding = componentPath.scope.getBinding(name);
      if (binding) reactiveBindings.set(binding, name);
    }
    for (const name of ctx.state.keys()) {
      const binding = componentPath.scope.getBinding(name);
      if (binding?.scope.path.isProgram()) {
        reactiveBindings.set(binding, name);
      }
    }

    const derivations: LocalDerivation[] = [];
    const derivedBindings = new Set<string>();
    const derivedSources = new Map<string, Set<string>>();

    /**
     * Classify how an opaque local is used inside a candidate initializer.
     * Only PROPERTY READS through the value (`tasksResource.data?.todos`)
     * are pure, replayable live queries. Using the opaque value ITSELF as a
     * value — destructuring (`const { status } = users`), copying, invoking
     * it (`taskApi.$fetch(...)`), or passing it as an argument — takes a
     * snapshot or hands control outside: such initializers must run once in
     * the factory.
     */
    const opaqueUseIsLiveRead = (
      start: NodePath<t.Identifier>,
    ): boolean => {
      let current: NodePath = start;
      let climbed = false;
      for (;;) {
        const parent: NodePath | undefined = current.parentPath;
        if (parent === undefined) break;
        if (
          (parent.isMemberExpression() &&
            parent.node.object === current.node) ||
          (parent.isOptionalMemberExpression() &&
            parent.node.object === current.node)
        ) {
          current = parent;
          climbed = true;
          continue;
        }
        break;
      }
      // A bare reference to the opaque value itself is snapshot semantics.
      if (!climbed) return false;
      const user = current.parentPath;
      if (user !== undefined) {
        if (
          (user.isCallExpression() || user.isNewExpression()) &&
          user.node.callee === current.node
        ) {
          return false;
        }
        if (
          (user.isCallExpression() || user.isNewExpression()) ||
          user.isSpreadElement()
        ) {
          return false; // passed as an argument — escapes our control
        }
        if (
          user.isAssignmentExpression() &&
          user.node.left === current.node
        ) {
          return false;
        }
      }
      return true;
    };

    /**
     * How opaque locals appear in a candidate initializer:
     * - 'none': no opaque use — the reactive-read path decides alone.
     * - 'ok':   every opaque use is a pure member read (live derivation).
     * - 'bad':  some opaque use snapshots or escapes — keep factory-time.
     * Reads of already-accepted derivation bindings are reactive reads, not
     * opaque uses, even when the derivation itself is opaque-rooted.
     */
    const classifyOpaqueReads = (initPath: NodePath): 'none' | 'ok' | 'bad' => {
      let verdict: 'none' | 'ok' | 'bad' = 'none';
      initPath.traverse({
        Function(functionPath) {
          const parent = functionPath.parentPath;
          const participatesInCall =
            (parent.isCallExpression() || parent.isNewExpression()) &&
            (parent.node.callee === functionPath.node ||
              parent.node.arguments.some(
                (argument) => argument === functionPath.node,
              ));
          if (!participatesInCall) functionPath.skip();
        },
        ReferencedIdentifier(path) {
          if (verdict === 'bad' || !path.isIdentifier()) return;
          const binding = path.scope.getBinding(path.node.name);
          if (binding !== undefined && reactiveBindings.has(binding)) return;
          if (!isOpaqueLocal(path.node.name, path)) return;
          verdict = opaqueUseIsLiveRead(path) ? 'ok' : 'bad';
        },
      });
      return verdict;
    };

    const statements = componentPath.get('body').get('body');
    for (const statementPath of statements) {
      if (!statementPath.isVariableDeclaration({ kind: 'const' })) continue;
      for (const declarationPath of statementPath.get('declarations')) {
        const declaration = declarationPath.node;
        if (
          (!t.isIdentifier(declaration.id) &&
            !t.isObjectPattern(declaration.id) &&
            !t.isArrayPattern(declaration.id)) ||
          declaration.init == null ||
          t.isFunction(declaration.init)
        ) {
          continue;
        }
        if (
          t.isIdentifier(declaration.id) &&
          ctx.instanceState
            .get(componentName)
            ?.has(declaration.id.name) === true &&
          (isStoreObject(declaration.init) ||
            isConstObjectState(declaration.init))
        ) {
          continue;
        }
        const initPath = declarationPath.get('init');
        if (!initPath.isExpression()) continue;
        // An initializer that invokes or hands off an opaque value performs
        // side effects (fetches, client construction): keep it factory-time.
        if (classifyOpaqueReads(initPath) === 'bad') continue;

        const directReads = new Set<string>();
        let reason: string | null = null;
        const bindingIsReactive = (name: string, at: NodePath): boolean => {
          const binding = at.scope.getBinding(name);
          return binding !== undefined && reactiveBindings.has(binding);
        };
        const noteIdentifier = (path: NodePath): void => {
          if (!t.isIdentifier(path.node)) return;
          const binding = path.scope.getBinding(path.node.name);
          const source =
            binding === undefined ? undefined : reactiveBindings.get(binding);
          if (source !== undefined) directReads.add(source);
          else if (isOpaqueLocal(path.node.name, path)) {
            directReads.add(path.node.name);
          }
        };
        const mutationRoot = (node: t.Node): string | null =>
          t.isIdentifier(node)
            ? node.name
            : t.isMemberExpression(node)
              ? memberRootName(node)
              : null;
        const helperCache = new Map<
          t.Function,
          LocalDerivationHelperSummary
        >();
        const helperVisiting = new Set<t.Function>();
        const noteCall = (path: NodePath<t.CallExpression>): void => {
          const callee = path.node.callee;
          if (!t.isIdentifier(callee)) return;
          const local = summarizeLocalDerivationHelper(
            ctx,
            componentPath,
            path,
            callee.name,
            reactiveBindings,
            helperCache,
            helperVisiting,
          );
          if (local !== null) {
            for (const read of local.reads) directReads.add(read);
            reason ??= local.reason;
            return;
          }
          if (
            !ctx.helpers.has(callee.name) &&
            !ctx.importedFunctions.has(callee.name)
          ) {
            return;
          }
          const summary =
            ctx.importedFunctions.get(callee.name) ??
            summarizeHelper(ctx, callee.name);
          for (const read of summary.reads) directReads.add(read);
          if (
            summary.writes.size !== 0 ||
            summary.boundedWrites.size !== 0
          ) {
            reason ??= `calls helper '${callee.name}' which writes reactive state`;
          } else if (summary.unbounded && ctx.helpers.has(callee.name)) {
            reason ??= `calls recursive helper '${callee.name}' which cannot be analyzed`;
          }
        };

        // A bare opaque identifier as the whole initializer is a snapshot
        // (`const { status } = users`) — never a live read — so only note it
        // when it resolves to reactive state.
        if (
          initPath.isReferencedIdentifier() &&
          !isOpaqueLocal(initPath.node.name, initPath)
        ) {
          noteIdentifier(initPath);
        }
        if (initPath.isAssignmentExpression()) {
          const root = mutationRoot(initPath.node.left);
          if (root !== null && bindingIsReactive(root, initPath)) {
            reason = 'contains an assignment to reactive state';
          }
        } else if (initPath.isUpdateExpression()) {
          const root = mutationRoot(initPath.node.argument);
          if (root !== null && bindingIsReactive(root, initPath)) {
            reason = 'contains an update (++/--) to reactive state';
          }
        } else if (initPath.isAwaitExpression()) {
          reason = 'uses await; per-instance derivations must be synchronous';
        } else if (initPath.isYieldExpression()) {
          reason = 'uses yield; per-instance derivations must be synchronous';
        }
        if (initPath.isCallExpression()) noteCall(initPath);
        initPath.traverse({
          Function(functionPath) {
            const parent = functionPath.parentPath;
            const executesNow =
              (parent.isCallExpression() || parent.isNewExpression()) &&
              parent.node.callee === functionPath.node;
            if (!executesNow) {
              functionPath.skip();
            }
          },
          ReferencedIdentifier(path) {
            noteIdentifier(path);
          },
          AssignmentExpression(path) {
            const root = mutationRoot(path.node.left);
            if (root !== null && bindingIsReactive(root, path)) {
              reason = 'contains an assignment to reactive state';
            }
          },
          UpdateExpression(path) {
            const root = mutationRoot(path.node.argument);
            if (root !== null && bindingIsReactive(root, path)) {
              reason = 'contains an update (++/--) to reactive state';
            }
          },
          AwaitExpression() {
            reason = 'uses await; per-instance derivations must be synchronous';
          },
          YieldExpression() {
            reason = 'uses yield; per-instance derivations must be synchronous';
          },
          CallExpression(path) {
            noteCall(path);
          },
        });

        if (directReads.size === 0) continue;
        initPath.traverse({
          Function(functionPath) {
            const parent = functionPath.parentPath;
            const participatesInCall =
              (parent.isCallExpression() || parent.isNewExpression()) &&
              (parent.node.callee === functionPath.node ||
                parent.node.arguments.some(
                  (argument) => argument === functionPath.node,
                ));
            if (!participatesInCall) functionPath.skip();
          },
          ReferencedIdentifier(path) {
            noteIdentifier(path);
          },
          AssignmentExpression(path) {
            const root = mutationRoot(path.node.left);
            if (root !== null && bindingIsReactive(root, path)) {
              reason = 'contains an assignment to reactive state';
            }
          },
          UpdateExpression(path) {
            const root = mutationRoot(path.node.argument);
            if (root !== null && bindingIsReactive(root, path)) {
              reason = 'contains an update (++/--) to reactive state';
            }
          },
          AwaitExpression() {
            reason = 'uses await; per-instance derivations must be synchronous';
          },
          YieldExpression() {
            reason = 'uses yield; per-instance derivations must be synchronous';
          },
          CallExpression(path) {
            noteCall(path);
          },
        });
        if (reason !== null) {
          const names = bindingNames(declaration.id);
          throw declarationPath.buildCodeFrameError(
            `memo-dom: local const '${
              names.join(', ') || '<pattern>'
            }' is a per-instance derivation but ${reason}`,
          );
        }

        const names = bindingNames(declaration.id);
        const sources = new Set<string>();
        for (const read of directReads) {
          const upstream = derivedSources.get(read);
          if (upstream === undefined) sources.add(read);
          else for (const source of upstream) sources.add(source);
        }
        derivations.push({
          declaration: statementPath.node,
          target: t.cloneNode(declaration.id),
          source: t.cloneNode(declaration.init),
          bindings: names,
          sources: [...sources].sort(),
        });
        for (const name of names) {
          derivedBindings.add(name);
          derivedSources.set(name, new Set(sources));
          const binding = componentPath.scope.getBinding(name);
          if (binding) reactiveBindings.set(binding, name);
          ctx.instanceState.get(componentName)?.delete(name);
        }
      }
    }

    if (derivations.length === 0) continue;
    ctx.instanceDerivations.set(componentName, derivations);
    ctx.instanceDerivedBindings.set(componentName, derivedBindings);
    const exactSources = new Set<string>([
      ...(ctx.instanceState.get(componentName) ?? []),
      ...(ctx.componentProps.get(componentName)?.bindings ?? []),
    ]);
    const selective = [...exactSources].some((source) =>
      derivations.some(
        (derivation) => !derivation.sources.includes(source),
      ),
    );
    if (!selective) continue;
    const reasonSources = new Set<string>([
      ...exactSources,
      ...derivations.flatMap((derivation) => derivation.sources),
    ]);
    ctx.instanceReasonIds.set(
      componentName,
      new Map(
        [...reasonSources]
          .sort()
          .map((source, index) => [source, index]),
      ),
    );
    ctx.selectiveDerivationComponents.add(componentName);
  }
}
