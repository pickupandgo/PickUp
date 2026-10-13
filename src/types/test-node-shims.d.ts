/**
 * The few Node APIs the tests use to read source files (translation coverage). Node's full
 * type package is deliberately not loaded in this React Native project: its fetch, Headers and
 * AbortSignal globals clash with React Native's own.
 */
declare module 'fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
}

declare module 'path' {
  function join(...parts: string[]): string;
  const path: { join: typeof join };
  export default path;
}

declare const __dirname: string;
