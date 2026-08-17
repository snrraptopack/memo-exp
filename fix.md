# Architectural & Compiler Diagnostic Report

This document details compiler diagnostics and structural constraints identified during the construction and testing of the Apex Workspace application.

---

## 1. List Callback Statements / Local Derivations (`const` / `let` before `return`) Rejection on Keyed Map Sites

### Description
Declaring local variables or statements before the terminal `return <JSX />` inside an inline `.map(...)` list callback triggers a compiler diagnostic error claiming that the list callback body must be one JSX element or a block containing only `return <JSX />` under Rule 7 (`R7 L1`).

### Reproducible Example
```tsx
import { currentUser } from './mock-server';
import type { Message } from './types';

export function ReactionList({ message }: { message: Message }) {
  return (
    <div class="reactions-row">
      {/* ❌ Throws Compiler Error: list callback body must be one JSX element or a block containing only return <JSX /> */}
      {message.reactions.map((reaction) => {
        const hasReacted = reaction.userIds.includes(currentUser.id);
        return (
          <button
            key={reaction.emoji}
            class={hasReacted ? 'reaction-pill active' : 'reaction-pill'}
          >
            <span>{reaction.emoji}</span>
            <span>{reaction.count}</span>
          </button>
        );
      })}
    </div>
  );
}
```

### Diagnostic Output
```text
memo-dom: list callback body must be one JSX element or a block containing only return <JSX /> — R7 L1
```

### Root Cause Analysis
* In `packages/compiler/src/lists/map-site.ts`, `analyzeCallback` inspects the AST node of the list mapping function.
* When `callback.body` is a `BlockStatement`, the analyzer strictly asserts `callback.body.body.length === 1 && t.isReturnStatement(callback.body.body[0])`.
* When local statements (such as `const hasReacted = ...`) precede the `return` statement, `callback.body.body.length > 1`.
* Because `analyzeCallback` ignores blocks with more than one statement, it evaluates `returned` as `null` and `jsx` as `null`, triggering the Rule 7 diagnostic error.

---

## 2. Empty Return (`return null;` / `return false;` / `return undefined;`) Rejection in Component Control Flow

### Description
Writing an early return with an empty value (`return null;`, `return false;`, or `return undefined;`) inside a component body triggers a compiler diagnostic error claiming unsupported JSX return control flow under Rule 27 (`R27`).

### Reproducible Example
```tsx
import type { Message } from './types';

interface ThreadDrawerProps {
  message: Message | null;
}

export function ThreadDrawer({ message }: ThreadDrawerProps) {
  // ❌ Throws Compiler Error: component 'ThreadDrawer' has unsupported JSX return control flow
  if (!message) return null;

  return (
    <aside class="thread-drawer">
      <h2>Thread: #{message.channelId}</h2>
      <p>{message.content}</p>
    </aside>
  );
}
```

### Diagnostic Output
```text
memo-dom: component 'ThreadDrawer' has unsupported JSX return control flow; use a tail chain of JSX early returns, a terminal JSX if/else, or an exhaustive JSX switch
```

### Root Cause Analysis
* In `packages/compiler/src/components/return-plan.ts`, `analyzeComponentReturns` analyzes all top-level return paths in a component function to normalize them into a single structural conditional region (`ComponentReturnPlan`).
* The helper function `jsxReturn(statement)` verifies whether a return argument is a JSX element or fragment via `t.isJSXElement(statement.argument) || t.isJSXFragment(statement.argument)`.
* When an early return statement returns `null`, `false`, or `undefined` (e.g. `return null;`), `jsxReturn` returns `null` instead of identifying the statement as a valid empty conditional branch.
* Consequently, the total number of ReturnStatement nodes in the function AST (`returns.length`) exceeds the number of recognized JSX return branches (`branches.length`), causing `analyzeComponentReturns` to fail its structural validation and throw the control-flow diagnostic error.
