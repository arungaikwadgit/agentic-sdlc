// Vitest type shim — covers sandbox where vitest types aren't installed.
// Real vitest types (from npm install) take over on the user's machine.
declare module 'vitest' {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  // expect returns any so all chained matchers resolve without errors
  export function expect(value: unknown, message?: string): any;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;
  export const vi: {
    fn<T extends (...args: any[]) => any>(impl?: T): any;
    fn(): any;
    resetAllMocks(): void;
    clearAllMocks(): void;
    restoreAllMocks(): void;
    mock(moduleName: string, factory?: () => unknown): void;
    spyOn(obj: any, method: string): any;
  };
}
declare var global: typeof globalThis;
