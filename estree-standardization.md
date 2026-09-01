# Standardizing on ESTree: Motivations & Benefits

This document outlines the core motivations, philosophy, and long-term benefits of standardizing the `@memoized-dom/compiler` around standard **ESTree** and toolchain-agnostic data structures.

---

## 1. The Core Motive

A reactive DOM compiler's true value lies in its **domain semantics**:
* Determining which bindings are reactive roots, stores, or computed derivations
* Constructing fine-grained access tables and dependency routes
* Emitting optimized DOM construction templates and targeted commit handlers

These rules are independent of *who parsed the file* or *which AST library traversed the tree*.

When a compiler is tightly coupled to a single vendor toolchain (like Babel's mutable `NodePath` traversal), the core reactive engine becomes locked to that toolchain's internal lifecycle. Standardizing on ESTree ensures that the compiler's domain intelligence remains pure, portable, and decoupled from external parser quirks.

---

## 2. Why ESTree?

**ESTree** is the universal standard for JavaScript and TypeScript syntax trees across the modern ecosystem. It is the common dialect shared by:
* **Parsers & Compilers:** Yuku, Acorn, Meriyah, Espree, SWC, Biome
* **Bundlers & Engines:** Rollup, Rolldown, Vite, ESLint, Prettier

By adopting standard ESTree as the compiler's AST interface, `memoized-dom` speaks the universal language of JavaScript tooling.

---

## 3. Key Benefits

### A. Universal Toolchain Portability
* **No Single-Vendor Lock-in:** The compiler can run on Yuku today, a custom syntax frontend tomorrow, or inside a lightweight bundler plugin without rewriting the transformation logic.
* **Interchangeable Frontends:** Adapting to a new parser or build tool only requires a thin adapter wrapper, rather than refactoring the compiler's core.

### B. High-Speed Parsing Without Rewriting the Compiler Core
* **Fast native parsers behind one interface:** Yuku provides the current standard-language frontend, while another ESTree-producing parser can be registered without changing analysis or emission.
* By keeping the compiler pure TypeScript over ESTree, `memoized-dom` can use native parsing speed while keeping all domain logic maintainable and frontend-independent.

### C. Future-Proof Path to Native Tooling
* If the framework ever needs a fully native Rust plugin (e.g., for Rolldown or Turbopack), having a decoupled design makes porting trivial: it becomes a direct $1\text{--to--}1$ translation of pure functions and data structures, rather than untangling a web of mutable traversal hooks.

### D. Deterministic, Pure & Testable Logic
* **Predictable Data Flow:** Compilers that operate on pure AST structures (Input AST $\rightarrow$ Pure Analysis $\rightarrow$ Output AST) eliminate hidden mutation bugs caused by in-place tree edits during traversal.
* **Simplified Testing:** Unit testing compiler submodules becomes straightforward: pass a plain data object, assert on the returned structure, with zero mocking of complex toolchain context objects.

### E. Clean Separation of Concerns
* **Parser Layer:** Responsible solely for reading text into standard nodes.
* **Domain Engine:** Responsible solely for `memoized-dom` reactivity, access tables, and template planning.
* **Emitter Layer:** Responsible solely for formatting runtime JavaScript output.

---

## 4. Guiding North Star

> **"The compiler's reactivity logic must never know or care who parsed the source code."**

Standardizing on ESTree guarantees that `memoized-dom` remains modular, maintainable, high-performance, and ready for whatever JavaScript toolchains emerge in the future.
