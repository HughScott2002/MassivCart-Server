/**
 * Assert an invariant that can only be false due to a programmer error.
 * Operational failures (network, bad model output, bad user input) must use
 * Result (lib/result.ts) instead — assertions are for bugs and should crash loudly.
 */
export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}
