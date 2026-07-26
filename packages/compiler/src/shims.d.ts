// These two Babel plugins ship no type declarations and have no @types
// packages. They are parser/transform plugins with a single default export.
/** Babel plugin declarations not supplied by the installed packages. */
declare module '@babel/plugin-syntax-jsx' {
  const plugin: unknown;
  export default plugin;
}

declare module '@babel/plugin-transform-typescript' {
  const plugin: unknown;
  export default plugin;
}
