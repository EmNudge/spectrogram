import type {
  RenderOptions,
  ColorScale,
  DownsampleMode,
  FrequencyScale,
  InterpolationMode,
} from "./types";
import { COLOR_SCALES } from "./color-scales";
import { createFrequencyMapping } from "./frequency-mapping";
import { now, elapsed } from "./perf";

/**
 * Detailed timing breakdown for render operations
 */
export interface RenderTiming {
  totalTime: number;
  frequencyMappingTime: number;
  remappingTime: number;
  colorMappingTime: number;
  canvasWriteTime: number;
}

// ============================================================================
// COLOR LOOKUP TABLE OPTIMIZATION
// Pre-compute 256 RGB values for each color scale to avoid function calls
// ============================================================================

const COLOR_LUT_SIZE = 256;
const colorLUTCache = new Map<ColorScale, Uint8Array>();

/**
 * Get or create a color lookup table for the given color scale.
 * Returns a Uint8Array with COLOR_LUT_SIZE * 3 entries (RGB triplets).
 */
function getColorLUT(colorScale: ColorScale): Uint8Array {
  let lut = colorLUTCache.get(colorScale);
  if (!lut) {
    const colorFn = COLOR_SCALES[colorScale] || COLOR_SCALES.magma;
    lut = new Uint8Array(COLOR_LUT_SIZE * 3);
    for (let i = 0; i < COLOR_LUT_SIZE; i++) {
      const value = i / (COLOR_LUT_SIZE - 1);
      const [r, g, b] = colorFn(value);
      lut[i * 3] = r;
      lut[i * 3 + 1] = g;
      lut[i * 3 + 2] = b;
    }
    colorLUTCache.set(colorScale, lut);
  }
  return lut;
}

/**
 * Cubic interpolation using Catmull-Rom spline
 * Gives smoother results than linear interpolation
 */
function cubicInterpolate(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/**
 * Sample spectrum at a fractional bin position using specified interpolation
 */
function sampleSpectrum(
  spectrum: Float32Array,
  pos: number,
  interpolation: InterpolationMode,
): number {
  const len = spectrum.length;

  if (interpolation === "nearest") {
    const idx = Math.round(pos);
    return spectrum[Math.max(0, Math.min(len - 1, idx))];
  }

  const idx = Math.floor(pos);
  const frac = pos - idx;

  if (interpolation === "linear") {
    const i0 = Math.max(0, Math.min(len - 1, idx));
    const i1 = Math.max(0, Math.min(len - 1, idx + 1));
    return spectrum[i0] * (1 - frac) + spectrum[i1] * frac;
  }

  // Cubic interpolation
  const i0 = Math.max(0, Math.min(len - 1, idx - 1));
  const i1 = Math.max(0, Math.min(len - 1, idx));
  const i2 = Math.max(0, Math.min(len - 1, idx + 1));
  const i3 = Math.max(0, Math.min(len - 1, idx + 2));

  const result = cubicInterpolate(spectrum[i0], spectrum[i1], spectrum[i2], spectrum[i3], frac);
  return Math.max(0, result); // Clamp negative values from overshoot
}

/**
 * Calculate frequency gain boost for a given frequency
 * Audacity uses dB/decade - boost increases logarithmically above 1000 Hz
 */
function calculateFrequencyGain(hz: number, frequencyGain: number): number {
  if (frequencyGain === 0 || hz <= 1000) return 0;
  // dB boost per decade above 1000 Hz
  const decades = Math.log10(hz / 1000);
  return frequencyGain * decades;
}

/**
 * Calculate frequency at a given display bin position
 */
function getFrequencyAtBin(
  bin: number,
  displayBins: number,
  minFreq: number,
  maxFreq: number,
  freqScale: FrequencyScale,
): number {
  const t = bin / (displayBins - 1);

  if (freqScale === "linear") {
    return minFreq + t * (maxFreq - minFreq);
  } else if (freqScale === "log") {
    const logMin = Math.log10(minFreq);
    const logMax = Math.log10(maxFreq);
    return Math.pow(10, logMin + t * (logMax - logMin));
  } else {
    // For mel/bark/erb, approximate using linear interpolation
    return minFreq + t * (maxFreq - minFreq);
  }
}

/**
 * Remap spectrum with proper downsampling when display bins < source bins
 * Uses max or average to combine multiple source bins into one display bin
 * OPTIMIZED: Accepts output buffer to avoid allocation per frame
 */
function remapSpectrumWithDownsample(
  spectrum: Float32Array,
  freqMapping: Float32Array,
  displayBins: number,
  downsampleMode: DownsampleMode,
  interpolation: InterpolationMode,
  output?: Float32Array,
): Float32Array {
  const remapped = output || new Float32Array(displayBins);
  const specLen = spectrum.length;

  for (let i = 0; i < displayBins; i++) {
    const srcBin = freqMapping[i];

    // Determine the range of source bins that map to this display bin
    let srcBinStart: number;
    let srcBinEnd: number;

    if (i === 0) {
      srcBinStart = srcBin;
      srcBinEnd = i + 1 < displayBins ? (srcBin + freqMapping[i + 1]) * 0.5 : srcBin + 0.5;
    } else if (i === displayBins - 1) {
      srcBinStart = (freqMapping[i - 1] + srcBin) * 0.5;
      srcBinEnd = srcBin;
    } else {
      srcBinStart = (freqMapping[i - 1] + srcBin) * 0.5;
      srcBinEnd = (srcBin + freqMapping[i + 1]) * 0.5;
    }

    // Clamp to valid range
    if (srcBinStart < 0) srcBinStart = 0;
    if (srcBinEnd > specLen - 1) srcBinEnd = specLen - 1;

    const binLow = srcBinStart | 0; // Fast floor
    const binHigh = (srcBinEnd + 1) | 0; // Fast ceil

    if (binHigh <= binLow || downsampleMode === "nearest") {
      // Single bin or upsampling - use interpolation
      remapped[i] = sampleSpectrum(spectrum, srcBin, interpolation);
    } else if (downsampleMode === "max") {
      // Max mode - take the maximum value in the range
      let maxVal = sampleSpectrum(spectrum, srcBin, interpolation);
      for (let j = binLow; j <= binHigh && j < specLen; j++) {
        const val = spectrum[j];
        if (val > maxVal) maxVal = val;
      }
      remapped[i] = maxVal;
    } else {
      // Average mode - average all values in the range
      let sum = sampleSpectrum(spectrum, srcBin, interpolation);
      let count = 1;
      for (let j = binLow; j <= binHigh && j < specLen; j++) {
        sum += spectrum[j];
        count++;
      }
      remapped[i] = sum / count;
    }
  }

  return remapped;
}

/**
 * Render spectrogram to a canvas element
 * OPTIMIZED: Uses color LUT, buffer reuse, subarray instead of slice
 */
export function renderSpectrogram(options: RenderOptions): void {
  const {
    canvas,
    spectrogram,
    freqScale = "log",
    minFreq = 50,
    maxFreq = 8000,
    frequencyGain = 0,
    downsampleMode = "max",
    interpolation = "linear",
  } = options;
  const colorScale: ColorScale = options.colorScale ?? "magma";

  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Could not get 2D canvas context");
  }

  const { data, numFrames, numBins, sampleRate } = spectrogram;
  const nyquist = sampleRate / 2;

  // Determine display height - use all available frequency bins
  const displayBins = numBins;

  // Effective frequency range
  const effectiveMinFreq = Math.max(minFreq, 1);
  const effectiveMaxFreq = Math.min(maxFreq, nyquist);

  // Create frequency mapping
  const freqMapping = createFrequencyMapping(
    numBins,
    sampleRate,
    freqScale,
    displayBins,
    effectiveMinFreq,
    effectiveMaxFreq,
  );

  // Precompute frequency gain for each display bin
  const freqGainFactors = new Float32Array(displayBins);
  for (let bin = 0; bin < displayBins; bin++) {
    const hz = getFrequencyAtBin(bin, displayBins, effectiveMinFreq, effectiveMaxFreq, freqScale);
    const dbBoost = calculateFrequencyGain(hz, frequencyGain);
    freqGainFactors[bin] = dbBoost / 40;
  }

  // Resize canvas to fit spectrogram
  canvas.width = numFrames;
  canvas.height = displayBins;

  const imageData = ctx.createImageData(numFrames, displayBins);
  const pixels = imageData.data;

  // OPTIMIZATION: Use color lookup table
  const colorLUT = getColorLUT(colorScale);
  const lutMax = COLOR_LUT_SIZE - 1;

  // OPTIMIZATION: Pre-allocate reusable buffer
  const displayBuffer = new Float32Array(displayBins);

  for (let frame = 0; frame < numFrames; frame++) {
    const frameOffset = frame * numBins;
    // OPTIMIZATION: Use subarray instead of slice
    const frameSpectrum = data.subarray(frameOffset, frameOffset + numBins);

    // OPTIMIZATION: Reuse display buffer
    remapSpectrumWithDownsample(
      frameSpectrum,
      freqMapping,
      displayBins,
      downsampleMode,
      interpolation,
      displayBuffer,
    );

    for (let bin = 0; bin < displayBins; bin++) {
      let value = displayBuffer[bin] + freqGainFactors[bin];
      if (value < 0) value = 0;
      else if (value > 1) value = 1;

      // OPTIMIZATION: Use LUT
      const lutIdx = ((value * lutMax + 0.5) | 0) * 3;
      const r = colorLUT[lutIdx];
      const g = colorLUT[lutIdx + 1];
      const b = colorLUT[lutIdx + 2];

      const y = displayBins - 1 - bin;
      const pixelIndex = (y * numFrames + frame) * 4;

      pixels[pixelIndex] = r;
      pixels[pixelIndex + 1] = g;
      pixels[pixelIndex + 2] = b;
      pixels[pixelIndex + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * Result of renderToImageData with timing information
 */
export interface RenderResult {
  imageData: ImageData;
  timing: RenderTiming;
}

/**
 * Render spectrogram to an ImageData object (for use without DOM)
 * OPTIMIZED: Uses color LUT, buffer reuse, subarray instead of slice
 *
 * @param options - Render options (without canvas)
 * @returns ImageData containing the rendered spectrogram (or RenderResult if returnTiming is true)
 */
export function renderToImageData(
  options: Omit<RenderOptions, "canvas"> & { returnTiming?: boolean },
): ImageData | RenderResult {
  const {
    spectrogram,
    freqScale = "log",
    minFreq = 50,
    maxFreq = 8000,
    frequencyGain = 0,
    downsampleMode = "max",
    interpolation = "linear",
    returnTiming = false,
  } = options;
  const colorScale: ColorScale = options.colorScale ?? "magma";

  const totalStart = now();

  const { data, numFrames, numBins, sampleRate } = spectrogram;
  const nyquist = sampleRate / 2;

  // Determine display height - use all available frequency bins
  const displayBins = numBins;

  // Effective frequency range
  const effectiveMinFreq = Math.max(minFreq, 1);
  const effectiveMaxFreq = Math.min(maxFreq, nyquist);

  // Create frequency mapping
  const freqMapStart = now();
  const freqMapping = createFrequencyMapping(
    numBins,
    sampleRate,
    freqScale,
    displayBins,
    effectiveMinFreq,
    effectiveMaxFreq,
  );

  // Precompute frequency gain for each display bin
  const freqGainFactors = new Float32Array(displayBins);
  for (let bin = 0; bin < displayBins; bin++) {
    const hz = getFrequencyAtBin(bin, displayBins, effectiveMinFreq, effectiveMaxFreq, freqScale);
    const dbBoost = calculateFrequencyGain(hz, frequencyGain);
    freqGainFactors[bin] = dbBoost / 40;
  }
  const frequencyMappingTime = elapsed(freqMapStart);

  const imageData = new ImageData(numFrames, displayBins);
  const pixels = imageData.data;

  // OPTIMIZATION: Use color lookup table instead of function calls
  const colorLUT = getColorLUT(colorScale);
  const lutMax = COLOR_LUT_SIZE - 1;

  // OPTIMIZATION: Pre-allocate reusable buffer for spectrum remapping
  const displayBuffer = new Float32Array(displayBins);

  let remappingTime = 0;
  let colorMappingTime = 0;

  for (let frame = 0; frame < numFrames; frame++) {
    const frameOffset = frame * numBins;

    // OPTIMIZATION: Use subarray (view) instead of slice (copy)
    const frameSpectrum = data.subarray(frameOffset, frameOffset + numBins);

    const remapStart = now();
    // OPTIMIZATION: Reuse display buffer
    remapSpectrumWithDownsample(
      frameSpectrum,
      freqMapping,
      displayBins,
      downsampleMode,
      interpolation,
      displayBuffer,
    );
    remappingTime += elapsed(remapStart);

    const colorStart = now();
    for (let bin = 0; bin < displayBins; bin++) {
      let value = displayBuffer[bin] + freqGainFactors[bin];
      // Fast clamp
      if (value < 0) value = 0;
      else if (value > 1) value = 1;

      // OPTIMIZATION: Use LUT instead of function call
      const lutIdx = ((value * lutMax + 0.5) | 0) * 3; // Fast round and multiply
      const r = colorLUT[lutIdx];
      const g = colorLUT[lutIdx + 1];
      const b = colorLUT[lutIdx + 2];

      // High frequencies at top, low at bottom
      const y = displayBins - 1 - bin;
      const pixelIndex = (y * numFrames + frame) * 4;

      pixels[pixelIndex] = r;
      pixels[pixelIndex + 1] = g;
      pixels[pixelIndex + 2] = b;
      pixels[pixelIndex + 3] = 255;
    }
    colorMappingTime += elapsed(colorStart);
  }

  const totalTime = elapsed(totalStart);

  if (returnTiming) {
    return {
      imageData,
      timing: {
        totalTime,
        frequencyMappingTime,
        remappingTime,
        colorMappingTime,
        canvasWriteTime: 0, // N/A for ImageData
      },
    };
  }

  return imageData;
}
