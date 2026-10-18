/**
 * Minimal ambient types for react-test-renderer (no @types package is installed). Only the
 * surface the Phase 10 tests use. Tests are executed by babel-jest; this just keeps `tsc` happy.
 */
declare module 'react-test-renderer' {
  import type { ReactElement } from 'react';

  export interface ReactTestRendererJSON {
    type: string;
    props: Record<string, unknown>;
    children: null | Array<ReactTestRendererJSON | string>;
  }

  export interface ReactTestInstance {
    findByType(type: unknown): ReactTestInstance;
    findAllByType(type: unknown): ReactTestInstance[];
    props: Record<string, unknown>;
  }

  export interface ReactTestRenderer {
    toJSON(): ReactTestRendererJSON | null;
    unmount(): void;
    update(el: ReactElement): void;
    root: ReactTestInstance;
  }

  export function create(el: ReactElement, options?: unknown): ReactTestRenderer;
  export function act(callback: () => void | Promise<void>): Promise<undefined> | void;

  const TestRenderer: {
    create: typeof create;
    act: typeof act;
  };
  export default TestRenderer;
}
