/**
 * Build-time conditional performance instrumentation.
 *
 * In production builds: __BENCHMARK__ is defined as false by tsdown/esbuild,
 * and now()/elapsed() become `() => 0` - essentially free after JIT inlining.
 *
 * In development/benchmarks: Uses runtime check of globalThis.__BENCHMARK__
 * evaluated at call time (not module initialization time) to handle ESM hoisting.
 */

declare const __BENCHMARK__: boolean | undefined;

/**
 * Check if benchmarking is enabled.
 * Uses compile-time constant when available, falls back to runtime global.
 */
function isBenchmarkEnabled(): boolean {
  // Compile-time constant check - this branch is eliminated when __BENCHMARK__ is defined
  if (typeof __BENCHMARK__ !== "undefined") {
    return __BENCHMARK__;
  }
  // Runtime fallback for development/tsx (checked at call time)
  return (globalThis as any).__BENCHMARK__ === true;
}

/** Returns current time in ms when benchmarking, 0 otherwise */
export function now(): number {
  return isBenchmarkEnabled() ? performance.now() : 0;
}

/** Returns elapsed time from start when benchmarking, 0 otherwise */
export function elapsed(start: number): number {
  return isBenchmarkEnabled() ? performance.now() - start : 0;
}
