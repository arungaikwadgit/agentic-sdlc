// tests/vitest-shim.d.ts
// Provides type stubs for vitest when the full package types aren't available.
// On the user's Windows machine where vitest is properly installed, the real
// vitest types will take precedence over these stubs.
declare module 'vitest' {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function test(name: string, fn: () => void | Promise<void>): void;
  export function expect(value: unknown): any;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function beforeAll(fn: () => void | Promise<void>): void;
  export function afterAll(fn: () => void | Promise<void>): void;
  export const vi: {
    fn(): any;
    fn<T extends (...args: any[]) => any>(impl?: T): jest.Mock<ReturnType<T>, Parameters<T>>;
    resetAllMocks(): void;
    clearAllMocks(): void;
    restoreAllMocks(): void;
    mock(moduleName: string, factory?: () => unknown): void;
    spyOn(obj: any, method: string): any;
  };
}
// Provide global type for `global.fetch` in jsdom env
declare var global: typeof globalThis;
