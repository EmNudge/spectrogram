/**
 * Comprehensive benchmark suite for spectrogram library
 * Uses Vitest's benchmarking capabilities
 */

import { bench, describe } from "vitest";
import { generateSpectrogram, renderToImageData } from "../src/index.js";
import type {
  FFTContext,
  WindowType,
  SpectrogramAlgorithm,
  ColorScale,
  FrequencyScale,
  InterpolationMode,
  DownsampleMode,
} from "../src/types.js";

// Polyfill ImageData for Node.js
if (typeof globalThis.ImageData === "undefined") {
  (globalThis as any).ImageData = class ImageData {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    colorSpace: string = "srgb";

    constructor(width: number, height: number);
    constructor(data: Uint8ClampedArray, width: number, height?: number);
    constructor(arg1: number | Uint8ClampedArray, arg2: number, arg3?: number) {
      if (typeof arg1 === "number") {
        this.width = arg1;
        this.height = arg2;
        this.data = new Uint8ClampedArray(arg1 * arg2 * 4);
      } else {
        this.data = arg1;
        this.width = arg2;
        this.height = arg3 ?? arg1.length / 4 / arg2;
      }
    }
  };
}

// Create Cooley-Tukey FFT for more realistic benchmarks
function createFastFFTContext(size: number): FFTContext {
  const inputBuffer = new Float32Array(size);
  const outputBuffer = new Float32Array(size * 2);

  // Bit reversal permutation
  const bitReversed = new Uint32Array(size);
  const bits = Math.log2(size);
  for (let i = 0; i < size; i++) {
    let reversed = 0;
    let n = i;
    for (let j = 0; j < bits; j++) {
      reversed = (reversed << 1) | (n & 1);
      n >>= 1;
    }
    bitReversed[i] = reversed;
  }

  // Precompute twiddle factors
  const twiddleRe = new Float32Array(size / 2);
  const twiddleIm = new Float32Array(size / 2);
  for (let i = 0; i < size / 2; i++) {
    const angle = (-2 * Math.PI * i) / size;
    twiddleRe[i] = Math.cos(angle);
    twiddleIm[i] = Math.sin(angle);
  }

  return {
    size,
    isReal: true,
    getInputBuffer: () => inputBuffer,
    getOutputBuffer: () => outputBuffer,
    run: () => {
      const N = size;

      // Bit reversal copy
      for (let i = 0; i < N; i++) {
        const j = bitReversed[i];
        outputBuffer[j * 2] = inputBuffer[i];
        outputBuffer[j * 2 + 1] = 0;
      }

      // Cooley-Tukey iterative FFT
      for (let len = 2; len <= N; len *= 2) {
        const halfLen = len / 2;
        const step = N / len;

        for (let i = 0; i < N; i += len) {
          for (let j = 0; j < halfLen; j++) {
            const twIdx = j * step;
            const tRe = twiddleRe[twIdx];
            const tIm = twiddleIm[twIdx];

            const evenIdx = (i + j) * 2;
            const oddIdx = (i + j + halfLen) * 2;

            const evenRe = outputBuffer[evenIdx];
            const evenIm = outputBuffer[evenIdx + 1];
            const oddRe = outputBuffer[oddIdx];
            const oddIm = outputBuffer[oddIdx + 1];

            // Complex multiplication: (oddRe + i*oddIm) * (tRe + i*tIm)
            const prodRe = oddRe * tRe - oddIm * tIm;
            const prodIm = oddRe * tIm + oddIm * tRe;

            outputBuffer[evenIdx] = evenRe + prodRe;
            outputBuffer[evenIdx + 1] = evenIm + prodIm;
            outputBuffer[oddIdx] = evenRe - prodRe;
            outputBuffer[oddIdx + 1] = evenIm - prodIm;
          }
        }
      }
    },
  };
}

// Generate test audio samples
function generateTestAudio(sampleRate: number, duration: number): Float32Array {
  const numSamples = Math.floor(sampleRate * duration);
  const samples = new Float32Array(numSamples);

  // Generate a chirp signal (frequency sweep) with harmonics
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;

    // Chirp from 100 Hz to 8000 Hz
    const startFreq = 100;
    const endFreq = 8000;
    const phase = 2 * Math.PI * (startFreq * t + ((endFreq - startFreq) * t * t) / (2 * duration));

    // Add fundamental and harmonics
    samples[i] = Math.sin(phase) * 0.5 + Math.sin(phase * 2) * 0.25 + Math.sin(phase * 3) * 0.125;
  }

  return samples;
}

// Shared test data
const sampleRate = 44100;
const duration = 5;
const samples = generateTestAudio(sampleRate, duration);

// Pre-create FFT contexts
const fftContext256 = createFastFFTContext(256);
const fftContext512 = createFastFFTContext(512);
const fftContext1024 = createFastFFTContext(1024);
const fftContext2048 = createFastFFTContext(2048);
const fftContext4096 = createFastFFTContext(4096);

// Pre-generate spectrogram for rendering benchmarks
const spectrogramData = generateSpectrogram({
  samples,
  sampleRate,
  fftContext: fftContext2048,
  windowType: "hann",
  algorithm: "standard",
});

describe("FFT Size", () => {
  bench("256", () => {
    generateSpectrogram({
      samples,
      sampleRate,
      fftContext: fftContext256,
      windowType: "hann",
      algorithm: "standard",
    });
  });

  bench("512", () => {
    generateSpectrogram({
      samples,
      sampleRate,
      fftContext: fftContext512,
      windowType: "hann",
      algorithm: "standard",
    });
  });

  bench("1024", () => {
    generateSpectrogram({
      samples,
      sampleRate,
      fftContext: fftContext1024,
      windowType: "hann",
      algorithm: "standard",
    });
  });

  bench("2048", () => {
    generateSpectrogram({
      samples,
      sampleRate,
      fftContext: fftContext2048,
      windowType: "hann",
      algorithm: "standard",
    });
  });

  bench("4096", () => {
    generateSpectrogram({
      samples,
      sampleRate,
      fftContext: fftContext4096,
      windowType: "hann",
      algorithm: "standard",
    });
  });
});

describe("Algorithm", () => {
  const algorithms: SpectrogramAlgorithm[] = ["standard", "reassignment"];

  for (const algorithm of algorithms) {
    bench(algorithm, () => {
      generateSpectrogram({
        samples,
        sampleRate,
        fftContext: fftContext2048,
        windowType: "hann",
        algorithm,
      });
    });
  }
});

describe("Window Function", () => {
  const windowTypes: WindowType[] = [
    "hann",
    "hamming",
    "blackman",
    "blackmanHarris",
    "rectangular",
  ];

  for (const windowType of windowTypes) {
    bench(windowType, () => {
      generateSpectrogram({
        samples,
        sampleRate,
        fftContext: fftContext2048,
        windowType,
        algorithm: "standard",
      });
    });
  }
});

describe("Zero Padding", () => {
  const zeroPaddings = [1, 2, 4, 8];

  for (const zeroPadding of zeroPaddings) {
    bench(`${zeroPadding}x`, () => {
      generateSpectrogram({
        samples,
        sampleRate,
        fftContext: fftContext2048,
        windowType: "hann",
        algorithm: "standard",
        zeroPadding,
      });
    });
  }
});

describe("Hop Size / Overlap", () => {
  const hopSizes = [
    { name: "50% overlap (1024)", hopSize: 1024 },
    { name: "75% overlap (512)", hopSize: 512 },
    { name: "87.5% overlap (256)", hopSize: 256 },
    { name: "93.75% overlap (128)", hopSize: 128 },
  ];

  for (const { name, hopSize } of hopSizes) {
    bench(name, () => {
      generateSpectrogram({
        samples,
        sampleRate,
        fftContext: fftContext2048,
        windowType: "hann",
        algorithm: "standard",
        hopSize,
      });
    });
  }
});

describe("Color Scale", () => {
  const colorScales: ColorScale[] = ["viridis", "magma", "inferno", "hot", "grayscale"];

  for (const colorScale of colorScales) {
    bench(colorScale, () => {
      renderToImageData({
        spectrogram: spectrogramData,
        colorScale,
        freqScale: "log",
        interpolation: "linear",
      });
    });
  }
});

describe("Frequency Scale", () => {
  const freqScales: FrequencyScale[] = ["linear", "log", "mel", "bark", "erb"];

  for (const freqScale of freqScales) {
    bench(freqScale, () => {
      renderToImageData({
        spectrogram: spectrogramData,
        colorScale: "magma",
        freqScale,
        interpolation: "linear",
      });
    });
  }
});

describe("Interpolation Mode", () => {
  const interpolationModes: InterpolationMode[] = ["nearest", "linear", "cubic"];

  for (const interpolation of interpolationModes) {
    bench(interpolation, () => {
      renderToImageData({
        spectrogram: spectrogramData,
        colorScale: "magma",
        freqScale: "log",
        interpolation,
      });
    });
  }
});

describe("Downsample Mode", () => {
  const downsampleModes: DownsampleMode[] = ["nearest", "max", "average"];

  for (const downsampleMode of downsampleModes) {
    bench(downsampleMode, () => {
      renderToImageData({
        spectrogram: spectrogramData,
        colorScale: "magma",
        freqScale: "linear",
        interpolation: "linear",
        downsampleMode,
      });
    });
  }
});

describe("End-to-End Pipeline", () => {
  bench("Fast (FFT 512, standard, nearest)", () => {
    const spec = generateSpectrogram({
      samples,
      sampleRate,
      fftContext: fftContext512,
      windowType: "hann",
      algorithm: "standard",
    });
    renderToImageData({
      spectrogram: spec,
      colorScale: "magma",
      freqScale: "log",
      interpolation: "nearest",
    });
  });

  bench("Balanced (FFT 2048, standard, linear)", () => {
    const spec = generateSpectrogram({
      samples,
      sampleRate,
      fftContext: fftContext2048,
      windowType: "hann",
      algorithm: "standard",
    });
    renderToImageData({
      spectrogram: spec,
      colorScale: "magma",
      freqScale: "log",
      interpolation: "linear",
    });
  });

  bench("Quality (FFT 4096, standard, cubic)", () => {
    const spec = generateSpectrogram({
      samples,
      sampleRate,
      fftContext: fftContext4096,
      windowType: "hann",
      algorithm: "standard",
    });
    renderToImageData({
      spectrogram: spec,
      colorScale: "magma",
      freqScale: "log",
      interpolation: "cubic",
    });
  });

  bench("Best (FFT 4096, reassignment, cubic)", () => {
    const spec = generateSpectrogram({
      samples,
      sampleRate,
      fftContext: fftContext4096,
      windowType: "hann",
      algorithm: "reassignment",
    });
    renderToImageData({
      spectrogram: spec,
      colorScale: "magma",
      freqScale: "log",
      interpolation: "cubic",
    });
  });
});
