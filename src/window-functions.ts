import type { WindowFunction, WindowType } from "./types";

/**
 * Coherent gain (DC gain) for each window type.
 * This is the sum of window coefficients divided by N.
 * Used for proper amplitude normalization so a 0 dB sine displays as 0 dB.
 */
export const WINDOW_COHERENT_GAIN: Record<WindowType, number> = {
  hann: 0.5,
  hamming: 0.54,
  blackman: 0.42,
  blackmanHarris: 0.35875,
  rectangular: 1.0,
};

// ============================================================================
// WINDOW COEFFICIENT CACHING
// Pre-compute window coefficients once per (type, size) pair to avoid
// expensive trig calls on every sample of every frame.
// ============================================================================

type WindowVariant = "standard" | "derivative" | "timeRamped";

interface CachedWindow {
  coefficients: Float32Array;
}

const windowCache = new Map<string, CachedWindow>();

function getCacheKey(type: WindowType, size: number, variant: WindowVariant): string {
  return `${type}-${size}-${variant}`;
}

/**
 * Get pre-computed window coefficients. Computes and caches on first call.
 */
export function getWindowCoefficients(
  type: WindowType,
  size: number,
  variant: WindowVariant = "standard",
): Float32Array {
  const key = getCacheKey(type, size, variant);

  let cached = windowCache.get(key);
  if (!cached) {
    const coefficients = new Float32Array(size);
    let fn: WindowFunction;

    switch (variant) {
      case "derivative":
        fn = WINDOW_DERIVATIVES[type] || WINDOW_DERIVATIVES.hann;
        break;
      case "timeRamped":
        fn = WINDOW_TIME_RAMPED[type] || WINDOW_TIME_RAMPED.hann;
        break;
      default:
        fn = WINDOW_FUNCTIONS[type] || WINDOW_FUNCTIONS.hann;
    }

    for (let i = 0; i < size; i++) {
      coefficients[i] = fn(i, size);
    }

    cached = { coefficients };
    windowCache.set(key, cached);
  }

  return cached.coefficients;
}

/**
 * Apply pre-computed window coefficients to a frame.
 * Much faster than computing trig functions per sample.
 */
export function applyWindowCoefficients(
  frame: Float32Array,
  coefficients: Float32Array,
  output?: Float32Array,
): Float32Array {
  const N = frame.length;
  const result = output || new Float32Array(N);

  for (let i = 0; i < N; i++) {
    result[i] = frame[i] * coefficients[i];
  }

  return result;
}

/**
 * Clear the window coefficient cache.
 * Useful for memory management in long-running applications.
 */
export function clearWindowCache(): void {
  windowCache.clear();
}

/**
 * Window functions for spectral analysis
 */
export const WINDOW_FUNCTIONS: Record<WindowType, WindowFunction> = {
  hann: (i, N) => 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1))),

  hamming: (i, N) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (N - 1)),

  blackman: (i, N) =>
    0.42 -
    0.5 * Math.cos((2 * Math.PI * i) / (N - 1)) +
    0.08 * Math.cos((4 * Math.PI * i) / (N - 1)),

  blackmanHarris: (i, N) => {
    const a0 = 0.35875;
    const a1 = 0.48829;
    const a2 = 0.14128;
    const a3 = 0.01168;
    return (
      a0 -
      a1 * Math.cos((2 * Math.PI * i) / (N - 1)) +
      a2 * Math.cos((4 * Math.PI * i) / (N - 1)) -
      a3 * Math.cos((6 * Math.PI * i) / (N - 1))
    );
  },

  rectangular: () => 1,
};

/**
 * Derivative window functions for reassignment algorithm
 * These are the derivatives d/di of the window functions
 */
export const WINDOW_DERIVATIVES: Record<WindowType, WindowFunction> = {
  hann: (i, N) => (Math.PI / (N - 1)) * Math.sin((2 * Math.PI * i) / (N - 1)),

  hamming: (i, N) => 0.46 * ((2 * Math.PI) / (N - 1)) * Math.sin((2 * Math.PI * i) / (N - 1)),

  blackman: (i, N) =>
    0.5 * ((2 * Math.PI) / (N - 1)) * Math.sin((2 * Math.PI * i) / (N - 1)) -
    0.08 * ((4 * Math.PI) / (N - 1)) * Math.sin((4 * Math.PI * i) / (N - 1)),

  blackmanHarris: (i, N) => {
    const a1 = 0.48829;
    const a2 = 0.14128;
    const a3 = 0.01168;
    return (
      a1 * ((2 * Math.PI) / (N - 1)) * Math.sin((2 * Math.PI * i) / (N - 1)) -
      a2 * ((4 * Math.PI) / (N - 1)) * Math.sin((4 * Math.PI * i) / (N - 1)) +
      a3 * ((6 * Math.PI) / (N - 1)) * Math.sin((6 * Math.PI * i) / (N - 1))
    );
  },

  rectangular: () => 0,
};

/**
 * Time-ramped window functions for reassignment algorithm
 * These are (i - N/2) * h(i), centered around the middle of the window
 */
export const WINDOW_TIME_RAMPED: Record<WindowType, WindowFunction> = {
  hann: (i, N) => (i - (N - 1) / 2) * WINDOW_FUNCTIONS.hann(i, N),
  hamming: (i, N) => (i - (N - 1) / 2) * WINDOW_FUNCTIONS.hamming(i, N),
  blackman: (i, N) => (i - (N - 1) / 2) * WINDOW_FUNCTIONS.blackman(i, N),
  blackmanHarris: (i, N) => (i - (N - 1) / 2) * WINDOW_FUNCTIONS.blackmanHarris(i, N),
  rectangular: (i, N) => i - (N - 1) / 2,
};

/**
 * Apply a window function to a frame of samples
 */
export function applyWindow(frame: Float32Array, windowType: WindowType = "hann"): Float32Array {
  const N = frame.length;
  const windowed = new Float32Array(N);
  const windowFn = WINDOW_FUNCTIONS[windowType] || WINDOW_FUNCTIONS.hann;

  for (let i = 0; i < N; i++) {
    windowed[i] = frame[i] * windowFn(i, N);
  }

  return windowed;
}

/**
 * Zero-pad a frame to a target size
 */
export function zeroPad(frame: Float32Array, targetSize: number): Float32Array {
  if (frame.length >= targetSize) return frame;
  const padded = new Float32Array(targetSize);
  padded.set(frame);
  return padded;
}
