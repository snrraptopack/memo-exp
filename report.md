# Detailed Compiler Codebase Analysis & Structural Improvements

Based on my comprehensive analysis of the compiler directory, I've identified significant opportunities for code deduplication and structural improvements. Here's my detailed assessment:

## **Current Structure Overview**

```
packages/compiler/src/
├── Top-level orchestration (7 files, ~200KB total)
├── analysis/ (11 files, ~90KB)
├── ast/ (13 files, ~100KB)
├── ast/tsrx/ (6 files, ~35KB)
├── components/ (17 files, ~120KB)
├── context/ (2 files, ~45KB)
├── emission/ (8 files, ~110KB)
├── handlers/ (2 files, ~55KB)
├── jsx/ (8 files, ~55KB)
└── lists/ (5 files, ~45KB)
```

## **Critical Deduplication Issues**

### **1. AST Helper Functions Duplication (High Priority)**

**Problem:** The same helper functions are duplicated across 20+ files:

```typescript
// Found in 21 different files:
function fields(node: BaseNode): Record<string, unknown> {
  return node as unknown as Record<string, unknown>;
}

// Found in 31 different files:
function childNode(parent: BaseNode, key: string): BaseNode | null {
  const value = fields(parent)[key];
  return value !== null && typeof value === 'object' && 'type' in value
    ? value as BaseNode
    : null;
}

// Found in 14 different files:
function childNodes(parent: BaseNode, key: string): BaseNode[] {
  const value = fields(parent)[key];
  return Array.isArray(value)
    ? value.filter((item): item is BaseNode =>
        item !== null && typeof item === 'object' && 'type' in item)
    : [];
}
```

**Impact:** ~1,000+ lines of duplicated code across the codebase.

**Solution:** Create a centralized AST utilities module:

```typescript
// packages/compiler/src/ast/node-utils.ts
export function fields(node: BaseNode): Record<string, unknown> {
  return node as unknown as Record<string, unknown>;
}

export function childNode(parent: BaseNode, key: string): BaseNode | null {
  const value = fields(parent)[key];
  return value !== null && typeof value === 'object' && 'type' in value
    ? value as BaseNode
    : null;
}

export function childNodes(parent: BaseNode, key: string): BaseNode[] {
  const value = fields(parent)[key];
  return Array.isArray(value)
    ? value.filter((item): item is BaseNode =>
        item !== null && typeof item === 'object' && 'type' in item)
    : [];
}

// Additional common helpers
export function stringValue(node: BaseNode | null): string | null;
export function identifierName(node: BaseNode | null): string | null;
export function attributeNamed(element: t.JSXElement, name: string): t.JSXAttribute | undefined;
```

### **2. Import Consolidation (Medium Priority)**

**Problem:** Repetitive import patterns in almost every file:

```typescript
// Repeated 59 times:
import * as astFactory from './ast/factory';

// Repeated 28 times:
import { cloneNode as cloneEstreeNode } from './ast';

// Repeated 100+ times:
import { walkAst, type BaseNode } from './ast';
```

**Solution:** Create barrel exports and common imports:

```typescript
// packages/compiler/src/ast/index.ts
export * from './compiler-types';
export * from './factory';
export * from './builders';
export * from './walk';
export * from './scope';
export * from './node-utils'; // new centralized utilities

// Common import pattern
export {
  cloneNode,
  walkAst,
  type BaseNode,
  type Binding,
  type Identifier
} from './index';
```

### **3. Large Monolithic Files (High Priority)**

**Problem:** Several files are too large and handle multiple responsibilities:

- `analysis.ts` (60KB) - Analysis orchestration + JSX validation + read attribution
- `data-sources.ts` (110KB) - Transparent async data + SSR lowering + policy rendering
- `emit.ts` (41KB) - JSX DOM emission + structural regions + multiple concerns
- `linker.ts` (53KB) - Module linking + component graph + route analysis

**Solution:** Break down by responsibility:

```typescript
// analysis.ts → split into:
// - analysis/orchestration.ts (coordination)
// - analysis/jsx-validation.ts (JSX-specific analysis)
// - analysis/read-attribution.ts (read analysis)
// - analysis/state-discovery.ts (state discovery)

// data-sources.ts → split into:
// - data-sources/transparent-lowering.ts (colorless async)
// - data-sources/ssr-lowering.ts (SSR-specific)
// - data-sources/policy-rendering.ts (policy rendering)
// - data-sources/module-scanning.ts (source discovery)

// emit.ts → split into:
// - emit/jsx-dom.ts (DOM emission)
// - emit/structural-regions.ts (conditional/list regions)
// - emit/slot-management.ts (content slots)
```

### **4. Inconsistent AST Manipulation Patterns (Medium Priority)**

**Problem:** Different files use different patterns for the same operations:

```typescript
// Pattern 1 (data-sources.ts):
function fields(node: BaseNode): Record<string, unknown> {
  return node as unknown as Record<string, unknown>;
}

// Pattern 2 (router.ts):
function node(value: unknown): BaseNode | null {
  return value !== null && typeof value === 'object' && 'type' in value
    ? (value as BaseNode)
    : null;
}

// Pattern 3 (analysis/computed.ts):
function field(node: BaseNode, name: string): unknown {
  return (node as unknown as Record<string, unknown>)[name];
}
```

**Solution:** Standardize on one pattern through centralized utilities.

## **Recommended Structural Improvements**

### **Phase 1: Immediate Deduplication (High Impact)**

1. **Create `ast/node-utils.ts`** with common helper functions
2. **Create `ast/common-exports.ts`** for frequent imports
3. **Replace all duplicate helpers** with centralized versions
4. **Update imports** to use common exports

**Expected Impact:**
- Remove ~1,000+ lines of duplicate code
- Reduce bundle size
- Improve maintainability
- Consistent behavior across modules

### **Phase 2: File Restructuring (Medium Impact)**

1. **Split large files** by single responsibility:
   ```typescript
   // Current: analysis.ts (60KB)
   // After:
   // - analysis/orchestration.ts (~15KB)
   // - analysis/jsx-validation.ts (~20KB)
   // - analysis/read-attribution.ts (~15KB)
   // - analysis/state-discovery.ts (~10KB)
   ```

2. **Create domain-specific subdirectories**:
   ```
   analysis/
   ├── orchestration/
   ├── jsx/
   ├── state/
   ├── reads/
   └── control-flow/
   ```

3. **Consolidate related functionality**:
   ```
   // Move all component-related analysis to:
   components/analysis/
   ├── props-analysis.ts
   ├── children-analysis.ts
   ├── lifecycle-analysis.ts
   └── ref-analysis.ts
   ```

### **Phase 3: Pattern Standardization (Medium Impact)**

1. **Standardize AST manipulation patterns**
2. **Create helper modules for common operations**:
   ```typescript
   // ast/identifier-utils.ts
   export function getIdentifierName(node: BaseNode): string | null;
   export function isIdentifier(node: BaseNode): node is t.Identifier;
   export function createIdentifier(name: string): t.Identifier;

   // ast/jsx-utils.ts
   export function getJsxAttributeName(attr: t.JSXAttribute): string;
   export function isJsxElement(node: BaseNode): node is t.JSXElement;
   export function getJsxChildren(element: t.JSXElement): t.JSXElement['children'];
   ```

3. **Standardize error handling patterns**
4. **Create common diagnostic builders**

### **Phase 4: Interface Consolidation (Low Impact)**

1. **Extract common interfaces** to shared types files:
   ```typescript
   // types/analysis.ts
   export interface AnalysisContext;
   export interface ComponentAnalysis;
   export interface StateAnalysis;

   // types/emission.ts
   export interface EmitContext;
   export interface EmitScope;
   export interface SlotDefinition;
   ```

2. **Create type guards** for common patterns:
   ```typescript
   // types/guards.ts
   export function isComponentNode(node: BaseNode): boolean;
   export function isHandlerNode(node: BaseNode): boolean;
   export function isEffectNode(node: BaseNode): boolean;
   ```

## **Specific Refactoring Recommendations**

### **1. Create Shared AST Utilities Module**

```typescript
// packages/compiler/src/ast/node-utils.ts
import type * as t from './compiler-types';
import type { BaseNode } from './types';

export function fields(node: BaseNode): Record<string, unknown> {
  return node as unknown as Record<string, unknown>;
}

export function childNode(parent: BaseNode, key: string): BaseNode | null {
  const value = fields(parent)[key];
  return value !== null && typeof value === 'object' && 'type' in value
    ? value as BaseNode
    : null;
}

export function childNodes(parent: BaseNode, key: string): BaseNode[] {
  const value = fields(parent)[key];
  return Array.isArray(value)
    ? value.filter((item): item is BaseNode =>
        item !== null && typeof item === 'object' && 'type' in item)
    : [];
}

export function stringValue(node: BaseNode | null): string | null {
  if (node?.type !== 'StringLiteral' && node?.type !== 'Literal') return null;
  const literal = fields(node).value;
  return typeof literal === 'string' ? literal : null;
}

export function identifierName(node: BaseNode | null): string | null {
  if (node?.type !== 'Identifier') return null;
  const name = fields(node).name;
  return typeof name === 'string' ? name : null;
}

export function isNode(value: unknown): value is BaseNode {
  return value !== null && typeof value === 'object' && 'type' in value;
}
```

### **2. Consolidate Import Patterns**

```typescript
// packages/compiler/src/ast/common.ts
// Centralized common imports
export * from './compiler-types';
export * as astFactory from './factory';
export { cloneNode, walkAst, type BaseNode, type Binding, type Identifier } from './index';
export * from './node-utils';

// Usage in other files:
import { astFactory, cloneNode, walkAst, type BaseNode, fields, childNode } from '../ast/common';
```

### **3. Split Large Files**

**Example: Splitting `data-sources.ts` (110KB)**

```typescript
// Current: data-sources.ts (110KB)
// Split into:

// data-sources/index.ts (coordination)
export * from './transparent-lowering';
export * from './ssr-lowering';
export * from './policy-rendering';
export * from './module-scanning';

// data-sources/transparent-lowering.ts (~40KB)
// Colorless async data source analysis and lowering

// data-sources/ssr-lowering.ts (~30KB)
// SSR-specific lowering and state cell operations

// data-sources/policy-rendering.ts (~25KB)
// Policy rendering and group management

// data-sources/module-scanning.ts (~15KB)
// Module-level source discovery and scanning
```

### **4. Create Domain-Specific Utilities**

```typescript
// jsx/element-utils.ts
export function getJsxElementName(element: t.JSXElement): string;
export function getJsxAttributes(element: t.JSXElement): t.JSXAttribute[];
export function hasDynamicChildren(element: t.JSXElement): boolean;

// components/prop-utils.ts
export function getPropValue(props: Record<string, unknown>, name: string): unknown;
export function hasProp(props: Record<string, unknown>, name: string): boolean;
export function isRenderProp(name: string): boolean;

// analysis/state-utils.ts
export function isReactiveBinding(binding: Binding): boolean;
export function getStateKey(binding: Binding): string;
export function isModuleState(binding: Binding): boolean;
```

## **Implementation Priority**

### **Week 1: Critical Deduplication**
1. Create `ast/node-utils.ts` with common helpers
2. Replace duplicate `fields`, `childNode`, `childNodes` functions
3. Create `ast/common.ts` for centralized imports
4. Update imports in top 10 most affected files

### **Week 2: Large File Splitting**
1. Split `data-sources.ts` into 4 focused files
2. Split `analysis.ts` into 4 focused files
3. Split `emit.ts` into 3 focused files
4. Update all imports and tests

### **Week 3: Pattern Standardization**
1. Create domain-specific utility modules
2. Standardize AST manipulation patterns
3. Create common type guards
4. Consolidate error handling

### **Week 4: Testing & Validation**
1. Run full test suite
2. Verify no breaking changes
3. Update documentation
4. Performance validation

## **Expected Benefits**

1. **Code Reduction**: Remove ~1,500+ lines of duplicate code
2. **Maintainability**: Single source of truth for common operations
3. **Consistency**: Standardized patterns across the codebase
4. **Performance**: Smaller bundle sizes, better tree-shaking
5. **Developer Experience**: Easier to understand and modify
6. **Testing**: More focused, testable modules

## **Risk Mitigation**

1. **Incremental Changes**: Implement one file at a time
2. **Comprehensive Testing**: Run full test suite after each change
3. **Backward Compatibility**: Maintain existing APIs during transition
4. **Documentation**: Update comments and documentation as changes are made
5. **Code Review**: Pair review for structural changes

This refactoring would significantly improve the compiler's maintainability while reducing technical debt and establishing patterns for future development.


report 2........

 ## Detailed Analysis of packages/compiler
  The @memoized-dom/compiler package transforms authored TypeScript and TSX into fine-grained reactive DOM
  templates, state access tables, and targeted commit updaters.

  The compiler codebase currently spans 68 source files and roughly 25,000 lines of code. While its core
  reactive model is innovative, the codebase suffers from significant structural fragmentation, monolithic
  "God-files", AST abstraction duplication, and repeated traversal/utility patterns.
  ──────
  ### 1. Current High-Level Architecture & Pipeline

  Compilation proceeds through five phases orchestrated by plugin.ts via plugin.ts:391-398:

           Authored TSX / TSRX Source
                       │
                       ▼
      [1. Frontend Parsing & AST Dialect Normalization]
          (Yuku / TSRX -> ESTree via src/ast/parser.ts)
                       │
                       ▼
      [2. AST Pre-processing & Normalization]
          - normalizeComponentDeclarations
          - normalizeConditionalJsxDirectives
          - scanAndLowerModuleSourceDeclarations
          - normalizeDynamicTags / normalizeRenderFunctions
                       │
                       ▼
      [3. Multi-Pass Semantic Analysis (src/analysis.ts)]
          - Discover State, Components & Helpers
          - Build Component Composition Graph & Acyclicity
          - Attribute Reads & Keyed-List / Conditional Dependencies
          - Construct Compile-Time Access Table
                       │
                       ▼
      [4. Event Handler & Effect Invalidation Analysis]
          - Map Writes to Innermost Scope
          - Synthesize Root / Receiver / Instance Commit Updates
                       │
                       ▼
      [5. Code Emission & Codegen (src/emit.ts & src/emission/)]
          - DOM Nodes & Cached Element Templates
          - List & Conditional Structural Regions
          - Factory ABIs, Dynamic Setters & Injected Runtime Imports
                       │
                       ▼
      [6. Post-processing & Code Printing]
          - Strip TypeScript Syntax (src/ast/strip-typescript.ts)
          - Esrap Code Printing + Source Map Generation
  ──────
  ### 2. Key Structural Issues

  #### A. Inconsistent Split: Flat Root Files vs. Subdirectories

  Half of each domain's files live loose in src while the rest live in dedicated subdirectories:

  • Analysis: analysis.ts (61 KB, 1,655 lines) sits at the root, while 11 specialized analysis files live
  under analysis.
  • Emission: emit.ts (42 KB, 1,367 lines) sits at the root, while 8 emission files live under emission.
  • Handlers: handlers.ts, handler-commits.ts, and handler-origin.ts sit at the root, while analyze.ts (53
  KB) lives under handlers.
  • Facades: context.ts (9 lines) and lists.ts (12 lines) are mere forwarding facades to context and lists.

  #### B. Giant Monolithic "God-Files"

  Several files exceed 1,000–3,000 lines and violate single-responsibility principles:

  1. data-sources.ts (3,264 lines, 110 KB): Contains transparent async data parsing, AST lowering, policy
  synthesis, Group/Pending/Error JSX transformation, event-source tracking, and code emission helpers all
  lumped into one giant file.
  2. analysis.ts (1,655 lines, 61 KB): Contains a single 530-line function analysis.ts:1043-1570 with 8
  nested sub-functions alongside component scanning, prop verification, and AST re-indexing.
  3. linker.ts (1,567 lines, 53 KB): Combines multi-pass module parsing, import graph resolution, function
  summary forwarding, and compile orchestration.
  4. analyze.ts (1,524 lines, 53 KB): Monolithic handler and alias tracking engine.
  5. emit.ts (1,367 lines, 42 KB) & list-region.ts (1,307 lines, 41 KB): Duplicate large sections of
  component calling and JSX attribute emission.

  #### C. Dueling AST Type Systems (Babel Migration Hangover)

  The codebase has two competing AST type systems:

  • types.ts defines pure ESTree node types (types.ts:18-25, Property, Literal).
  • compiler-types.ts aliases everything into Babel-style names (Node, ObjectProperty, StringLiteral).
  • builders.ts returns types.ts interfaces, while factory.ts wraps them to return compiler-types.ts
  interfaces.
  • Consequence: Over 200 occurrences of as unknown as BaseNode and as unknown as t.Node across the
  codebase, plus redundant wrapper functions like cloneCompilerNode and cloneAstNode.

  #### D. The Monolithic Context (Ctx)

  model.ts defines a single mutable Ctx struct with over 55 Maps, Sets, and WeakMaps. It acts as a global
  shared bus across all compiler passes. Because early passes mutate the AST in-place while populating
  Ctx, analysis.ts:1582 must be invoked three separate times during analysis to rebuild parent pointers.

  #### E. Circular Dependency Workarounds

  Because emit.ts is in the root directory while sub-emitters are in emission, list-region.ts and
  conditional-region.ts cannot directly import emitNode from emit.ts without creating circular
  dependencies. Instead, node-emitter.ts was introduced as a type trampoline to pass emitNode as a
  function argument through every layer.
  ──────
  ### 3. Concrete Deduplication Opportunities

   Target Pattern                 | Duplicate Instances               | Recommended Resolution
  --------------------------------|-----------------------------------|-----------------------------------
   identifierName(node)           | Defined independently in 13       | Move to access.ts and export
                                  | files: effects.ts:47,             | once.
                                  | dynamic-tags.ts:43,               |
                                  | helper-summaries.ts:37,           |
                                  | local-calls.ts:21, cells.ts:39,   |
                                  | type-candidates.ts:16,            |
                                  | opaque-volatility.ts:22,          |
                                  | module-discovery.ts:30,           |
                                  | instance.ts:47, computed.ts:37,   |
                                  | jsx-values.ts:40,                 |
                                  | prop-shape.ts:16,                 |
                                  | render-functions.ts:41.           |
   JSX Subtree Detection (hasJsx) | Re-implemented 5 times:           | Standardize on a single
                                  | ast.ts:407, map-site.ts:178,      | hasJsx(node) in src/ast/ (or
                                  | data-sources.ts:2615,             | src/jsx/).
                                  | callback-props.ts:56, and         |
                                  | module-discovery.ts:63.           |
   TypeScript Wrapper Unwrapping  | Manual while-loops matching       | Centralize in strip-typescript.ts
                                  | TSAsExpression, TSTypeAssertion,  | or access.ts as
                                  | TSNonNullExpression,              | unwrapTypeExpression.
                                  | TSSatisfiesExpression, and        |
                                  | TSInstantiationExpression         |
                                  | repeated in 6 files: ast.ts:96,   |
                                  | mutation-analysis.ts:223,         |
                                  | module-discovery.ts:44,           |
                                  | computed.ts:43, cells.ts:78, and  |
                                  | strip-typescript.ts:63.           |
   ComponentPath Type Alias       | type ComponentPath =              | Export type ComponentPath =
                                  | Ctx['compPaths'] extends          | CompilerPath<t.FunctionDeclaratio
                                  | Map<string, infer TPath> ? TPath  | n> from context/model.ts.
                                  | : never; copy-pasted across 14    |
                                  | files (emit.ts:93,                |
                                  | handlers.ts:54, lifecycle.ts:27,  |
                                  | list-region.ts:60, etc.).         |
   Diagnostic Path Wrappers       | ProgramPath, ProgramContainer,    | Export standard ProgramPath and
                                  | ProgramDiagnostic, ErrorPath,     | DiagnosticTarget<TNode> from
                                  | DiagnosticPath defined separately | context/model.ts.
                                  | in 8 files with slight            |
                                  | differences in method signatures. |
   Component Call & Prop Emission | emit.ts:620-750 and               | Extract into a shared
                                  | list-region.ts:890-985 share ~150 | emission/component-call.ts
                                  | lines of duplicate logic for      | module.
                                  | render props validation, scalar   |
                                  | callback instrumentation, error   |
                                  | messages, and slot compilation.   |
   stringValue(node)              | Identical logic in router.ts:53   | Move to src/ast/access.ts.
                                  | and dynamic-tags.ts:51.           |
   importedName(specifier)        | Identical implementation in       | Move to src/ast/access.ts.
                                  | data-sources.ts:52 and            |
                                  | external-reactivity.ts:12.        |
   FUNCTION_NODES Set             | Identical set literals in         | Export FUNCTION_NODES /
                                  | lifecycle.ts:36, computed.ts:15,  | isFunctionNode from
                                  | and factory.ts:178.               | src/ast/types.ts.
   Ad-hoc AST Node Construction   | cells.ts:49-70 re-implements      | Import standard builders from
                                  | private callExpression,           | src/ast/factory.ts.
                                  | binaryExpression, returnStatement |
                                  | builders casting with as t.*.     |
   memberRoot vs memberRootName   | mutation-analysis.ts:214          | Keep only memberRootName in
                                  | (memberRoot) and ast.ts:273       | context/ast.ts.
                                  | (memberRootName) do identical     |
                                  | member chain traversals.          |
   JSX Attribute Name Extraction  | attributes.ts:82,                 | Standardize on jsxAttributeName
                                  | component-reads.ts:16, and        | from jsx/attributes.ts.
                                  | opaque-volatility.ts:262 define   |
                                  | separate attribute name           |
                                  | extractors.                       |
  ──────
  ### 4. Recommended Codebase Restructuring

  To establish clean boundaries, eliminate duplication, and eliminate circular references, reorganize
  packages/compiler/src into six layered domains:

    packages/compiler/src/
    ├── index.ts                     # Public API entry point
    ├── compile.ts                   # High-level pipeline entry (source in, code + map out)
    │
    ├── ast/                         # 1. SYNTACTIC FOUNDATION (Parser & ESTree Tooling)
    │   ├── index.ts                 # Unified AST exports
    │   ├── types.ts                 # Single source of truth for AST types (retire compiler-types.ts)
    │   ├── builders.ts              # Pure node builders & type guards (merge factory.ts & builders.ts)
    │   ├── access.ts                # Node introspection: identifierName, stringValue, hasJsx, etc.
    │   ├── parser.ts                # Frontends: Yuku / TSRX
    │   ├── printer.ts               # Esrap printing & source maps
    │   ├── mutate.ts                # Tree mutation: replaceNode, removeNode, overwriteNode
    │   ├── scope.ts                 # Lexical scope analysis
    │   ├── walk.ts                  # Visitor traversal
    │   ├── strip-typescript.ts      # TS erasure & unwrapTypeExpression
    │   └── tsrx/                    # TSRX syntax extension lowering
    │
    ├── context/                     # 2. COMPILER STATE & SESSIONS
    │   ├── index.ts
    │   ├── model.ts                 # Ctx interface, modularized into sub-contexts
    │   ├── ast.ts                   # Reactive key extractors (memberKey, canonicalStateKey)
    │   ├── diagnostics.ts           # Diagnostics, code frames, errors (moved from root)
    │   └── identifiers.ts           # UID generator (moved from root)
    │
    ├── transforms/                  # 3. NORMALIZATION & PRE-PROCESSING
    │   ├── index.ts                 # Coordinated pre-analysis passes
    │   ├── component-declarations.ts# Top-level component normalization
    │   ├── conditional-directives.ts# <Tag if={...} else> sibling chain rewriting
    │   ├── dynamic-tags.ts          # Finite tag identity lowering
    │   ├── render-functions.ts      # Inline render helper inlining
    │   └── cells.ts                 # Module-level state cell lifting (moved from root)
    │
    ├── analysis/                    # 4. SEMANTIC ANALYSIS & ACCESS TABLE
    │   ├── index.ts                 # Orchestrator: runAnalysis (moved from root analysis.ts)
    │   ├── access-table.ts          # State dependency route table builder
    │   ├── component-graph.ts       # Hierarchy, parent-child wiring, acyclicity
    │   ├── component-reads.ts       # Reactive read attribution & collectReads
    │   ├── computed.ts              # Computed derivations & dirty-propagation
    │   ├── instance.ts              # Instance state & local derivations
    │   ├── instance-control-flow.ts # Local branches, switches, loops
    │   ├── module-discovery.ts      # Top-level state & function scanner
    │   ├── opaque-volatility.ts     # Unbounded / opaque source volatility
    │   ├── type-candidates.ts       # String literal & tag candidate extraction
    │   └── linker/                  # Cross-module linking (moved from root linker.ts)
    │       ├── index.ts             # compileModules & module linking
    │       └── graph.ts             # component-linker.ts
    │
    ├── handlers/                    # 5. MUTATION & COMMIT INVALDIATION
    │   ├── index.ts                 # Event-handler instrumentation coordinator
    │   ├── analyze.ts               # Write & mutation analysis
    │   ├── commits.ts               # Commit builder (moved from root handler-commits.ts)
    │   ├── origin.ts                # Origin tracking (moved from root handler-origin.ts)
    │   ├── mutation-provenance.ts   # Alias & provenance tracker (moved from root mutation-analysis.ts)
    │   └── helper-summaries.ts      # Interprocedural summaries (moved from root)
    │
    ├── emission/                    # 6. CODE GENERATION & RUNTIME FACTORIES
    │   ├── index.ts                 # Emission coordinator
    │   ├── dom.ts                   # Core DOM node emitter (moved from root emit.ts)
    │   ├── component.ts             # Component factory ABI & lifecycle
    │   ├── component-call.ts        # SHARED: prop validation, render slots, callbacks
    │   ├── list-region.ts           # Keyed lists, row factories, reconciliation
    │   ├── conditional-region.ts    # Anchored conditional branches
    │   ├── dom-template.ts          # Repeated DOM template cloning
    │   ├── route-region.ts          # Router branch regions
    │   ├── render-callback.ts       # Higher-order render callbacks
    │   └── scope.ts                 # EmitScope, slots, updater declarations
    │
    ├── features/                    # 7. INTEGRATED SUBSYSTEMS
    │   ├── data-sources/            # Deconstructed data-sources.ts (110 KB monolith)
    │   │   ├── index.ts             # Public transparent data facade
    │   │   ├── discovery.ts         # scanTransparentSourceImports & binding discovery
    │   │   ├── groups.ts            # Group / Suspense / Pending / Error lowerer
    │   │   ├── try-boundary.ts      # TSRX try-boundary lowering
    │   │   └── emission.ts          # Transparent data sites & policy renderers
    │   ├── router/                  # Unified routing (router.ts moved from root)
    │   │   ├── index.ts             # Route discovery & manifest builder
    │   │   └── jsx.ts               # Route & route-to attribute lowering
    │   ├── server-functions/        # HTTP RPC discovery (moved from root)
    │   │   ├── index.ts
    │   │   ├── analyze.ts
    │   │   └── client-generator.ts
    │   └── lifecycle/               # Lifecycle & effects (moved from root)
    │       ├── effects.ts           # effect() intrinsic lowering
    │       └── cleanup.ts           # cleanup() & callback instrumentation
  ──────
  ### 5. Recommended Refactoring Phases

  1. Phase 1: AST Unification & Utility Consolidation (Immediate low-risk deduplication)
      • Merge ast/builders.ts and ast/factory.ts into a single canonical builder module.
      • Centralize identifierName, stringValue, hasJsx, unwrapTypeExpression, and jsxAttributeName in
      ast/access.ts.
      • Remove the 13 duplicate copies of identifierName and 5 duplicate copies of hasJsx.
      • Export shared ProgramPath and ComponentPath type aliases from context/model.ts to delete 14
      duplicate type definitions.
  2. Phase 2: Directory Normalization (Fix root sprawl)
      • Move handler-commits.ts, handler-origin.ts, mutation-analysis.ts, and helper-summaries.ts into
      src/handlers/.
      • Move emit.ts into src/emission/dom.ts.
      • Move linker.ts and component-linker.ts into src/analysis/linker/.
      • Move cells.ts into src/transforms/cells.ts.
  3. Phase 3: Emission Deduplication & Call Normalization
      • Extract the shared ~150-line component call, render prop, and inline callback emission logic from
      emit.ts and emission/list-region.ts into a shared emission/component-call.ts.
      • Eliminate node-emitter.ts by having list-region.ts and conditional-region.ts directly import the
      unified DOM node emitter.
  4. Phase 4: Monolith Decomposition
      • Deconstruct the 110 KB data-sources.ts into discrete files under src/features/data-sources/
      (discovery.ts, groups.ts, try-boundary.ts, emission.ts).
      • Extract analysis.ts:1043 out of analysis.ts into analysis/component-reads.ts.
