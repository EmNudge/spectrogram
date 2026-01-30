import type {
  SpectrogramOptions,
  SpectrogramData,
  FrequencyRange,
  WindowType,
  FFTContext,
  SpectrogramTiming,
} from "./types";
import {
  WINDOW_COHERENT_GAIN,
  getWindowCoefficients,
  applyWindowCoefficients,
} from "./window-functions";
import { now, elapsed } from "./perf";

/**
 * Detailed timing breakdown for performance analysis
 */
export interface DetailedTiming extends SpectrogramTiming {
  windowingTime: number;
  zeroPaddingTime: number;
  magnitudeTime: number;
  normalizationTime: number;
  allocationTime: number;
  frameExtractionTime: number;
}

// ============================================================================
// OPTIMIZED HELPER FUNCTIONS
// ============================================================================

/**
 * Fast dB conversion using natural log instead of log10.
 * Math.log is faster than Math.log10 on most JS engines.
 * 20 * log10(x) = 20 * ln(x) / ln(10) = 20/ln(10) * ln(x)
 */
const DB_SCALE_FACTOR = 20 / Math.LN10; // ~8.685889638

function magnitudeToDb(magnitude: number): number {
  return DB_SCALE_FACTOR * Math.log(magnitude + 1e-10);
}

/**
 * Compute magnitude spectrum from complex FFT output into a pre-allocated buffer.
 */
function computeMagnitudeInPlace(
  complexOutput: Float32Array | Float64Array,
  numBins: number,
  magnitudes: Float32Array,
): void {
  for (let i = 0; i < numBins; i++) {
    const re = complexOutput[i * 2];
    const im = complexOutput[i * 2 + 1];
    magnitudes[i] = Math.sqrt(re * re + im * im);
  }
}

/**
 * Run FFT and return complex output as array of [re, im] pairs
 */
function runFFT(fftContext: FFTContext, data: Float32Array, fftSize: number): Float32Array {
  const inputBuffer = fftContext.getInputBuffer();
  const isReal = fftContext.isReal;

  if (isReal) {
    inputBuffer.set(data);
  } else {
    for (let i = 0; i < fftSize; i++) {
      inputBuffer[i * 2] = data[i] || 0;
      inputBuffer[i * 2 + 1] = 0;
    }
  }

  fftContext.run();

  const outputBuffer = fftContext.getOutputBuffer();
  const numBins = fftSize / 2 + 1;
  const result = new Float32Array(numBins * 2);

  for (let i = 0; i < numBins * 2; i++) {
    result[i] = outputBuffer[i];
  }

  return result;
}

/**
 * Generate standard spectrogram (no reassignment)
 * OPTIMIZED: Uses cached window coefficients, buffer reuse, fast dB conversion
 */
function generateStandardSpectrogram(
  samples: Float32Array,
  sampleRate: number,
  fftContext: FFTContext,
  hopSize: number,
  windowType: WindowType,
  zeroPadding: number,
  gain: number,
  range: number,
): {
  spectrogram: Float32Array;
  numFrames: number;
  detailedTiming: Omit<DetailedTiming, "totalTime" | "fftsPerSecond">;
} {
  const fftSize = fftContext.size;
  const windowSize = Math.floor(fftSize / zeroPadding);
  const numBins = fftSize / 2 + 1;
  const numFrames = Math.floor((samples.length - windowSize) / hopSize) + 1;

  if (numFrames <= 0) {
    throw new Error("Audio too short for the given FFT size");
  }

  // Timing markers
  let fftTime = 0;
  let windowingTime = 0;
  let zeroPaddingTime = 0;
  let magnitudeTime = 0;
  let normalizationTime = 0;
  let frameExtractionTime = 0;

  const allocStart = now();
  const spectrogram = new Float32Array(numFrames * numBins);
  // Pre-allocate reusable buffers
  const windowedBuffer = new Float32Array(windowSize);
  const paddedBuffer = zeroPadding > 1 ? new Float32Array(fftSize) : null;
  const magnitudeBuffer = new Float32Array(numBins);
  const allocationTime = elapsed(allocStart);

  // OPTIMIZATION: Get pre-computed window coefficients (cached)
  const windowCoeffs = getWindowCoefficients(windowType, windowSize, "standard");

  // Get coherent gain for proper normalization
  // A 0 dB (full-scale) sine wave should display as 0 dB
  const coherentGain = WINDOW_COHERENT_GAIN[windowType] || WINDOW_COHERENT_GAIN.hann;
  const normFactor = (fftSize * coherentGain) / 2;

  // Pre-compute normalization constants
  const dcBinsToSkip = 3;
  const gainOffset = gain - range;

  for (let frame = 0; frame < numFrames; frame++) {
    const offset = frame * hopSize;

    // OPTIMIZATION: Use subarray (view) instead of slice (copy)
    const extractStart = now();
    const frameData = samples.subarray(offset, offset + windowSize);
    frameExtractionTime += elapsed(extractStart);

    // OPTIMIZATION: Apply pre-computed window coefficients into reusable buffer
    const windowStart = now();
    applyWindowCoefficients(frameData, windowCoeffs, windowedBuffer);
    windowingTime += elapsed(windowStart);

    // Zero padding into reusable buffer
    const padStart = now();
    let fftInput: Float32Array;
    if (paddedBuffer) {
      paddedBuffer.set(windowedBuffer);
      // Clear the rest (zero padding)
      paddedBuffer.fill(0, windowSize);
      fftInput = paddedBuffer;
    } else {
      fftInput = windowedBuffer;
    }
    zeroPaddingTime += elapsed(padStart);

    // FFT
    const fftStart = now();
    const fftOutput = runFFT(fftContext, fftInput, fftSize);
    fftTime += elapsed(fftStart);

    // OPTIMIZATION: Compute magnitude into reusable buffer
    const magStart = now();
    computeMagnitudeInPlace(fftOutput, numBins, magnitudeBuffer);
    magnitudeTime += elapsed(magStart);

    // Normalization and dB conversion (using fast log)
    const normStart = now();
    const frameOffset = frame * numBins;
    for (let bin = 0; bin < dcBinsToSkip; bin++) {
      spectrogram[frameOffset + bin] = 0;
    }
    for (let bin = dcBinsToSkip; bin < numBins; bin++) {
      // Normalize by window's coherent gain for accurate dB display
      const normalizedMag = magnitudeBuffer[bin] / normFactor;
      const db = magnitudeToDb(normalizedMag);
      const normalized = (db - gainOffset) / range;
      spectrogram[frameOffset + bin] = normalized < 0 ? 0 : normalized > 1 ? 1 : normalized;
    }
    normalizationTime += elapsed(normStart);
  }

  return {
    spectrogram,
    numFrames,
    detailedTiming: {
      fftTime,
      windowingTime,
      zeroPaddingTime,
      magnitudeTime,
      normalizationTime,
      allocationTime,
      frameExtractionTime,
    },
  };
}

/**
 * Generate reassigned spectrogram
 * Uses 3 FFTs per frame to compute instantaneous frequency and group delay
 * OPTIMIZED: Uses cached window coefficients, buffer reuse, fast dB conversion
 */
function generateReassignedSpectrogram(
  samples: Float32Array,
  sampleRate: number,
  fftContext: FFTContext,
  hopSize: number,
  windowType: WindowType,
  zeroPadding: number,
  gain: number,
  range: number,
): {
  spectrogram: Float32Array;
  numFrames: number;
  detailedTiming: Omit<DetailedTiming, "totalTime" | "fftsPerSecond">;
} {
  const fftSize = fftContext.size;
  const windowSize = Math.floor(fftSize / zeroPadding);
  const numBins = fftSize / 2 + 1;
  const numFrames = Math.floor((samples.length - windowSize) / hopSize) + 1;

  if (numFrames <= 0) {
    throw new Error("Audio too short for the given FFT size");
  }

  // Timing markers
  let fftTime = 0;
  let windowingTime = 0;
  let zeroPaddingTime = 0;
  let magnitudeTime = 0; // Includes reassignment calculations
  let normalizationTime = 0;
  let frameExtractionTime = 0;

  // Accumulator for reassigned energy
  const allocStart = now();
  const spectrogram = new Float32Array(numFrames * numBins);
  const energyAccum = new Float32Array(numFrames * numBins);
  // Pre-allocate reusable buffers for 3 windows
  const windowedH = new Float32Array(windowSize);
  const windowedDh = new Float32Array(windowSize);
  const windowedTh = new Float32Array(windowSize);
  // Pre-allocate padded buffers if needed
  const paddedH = zeroPadding > 1 ? new Float32Array(fftSize) : null;
  const paddedDh = zeroPadding > 1 ? new Float32Array(fftSize) : null;
  const paddedTh = zeroPadding > 1 ? new Float32Array(fftSize) : null;
  const allocationTime = elapsed(allocStart);

  // OPTIMIZATION: Get pre-computed window coefficients (cached)
  const windowCoeffsH = getWindowCoefficients(windowType, windowSize, "standard");
  const windowCoeffsDh = getWindowCoefficients(windowType, windowSize, "derivative");
  const windowCoeffsTh = getWindowCoefficients(windowType, windowSize, "timeRamped");

  // Get coherent gain for proper normalization
  const coherentGain = WINDOW_COHERENT_GAIN[windowType] || WINDOW_COHERENT_GAIN.hann;
  const normFactor = (fftSize * coherentGain) / 2;

  // Pre-compute constants
  const dcBinsToSkip = 3;
  const gainOffset = gain - range;
  const freqCorrectionFactor = fftSize / (2 * Math.PI);

  for (let frame = 0; frame < numFrames; frame++) {
    const offset = frame * hopSize;

    // OPTIMIZATION: Use subarray (view) instead of slice (copy)
    const extractStart = now();
    const frameData = samples.subarray(offset, offset + windowSize);
    frameExtractionTime += elapsed(extractStart);

    // OPTIMIZATION: Apply pre-computed window coefficients into reusable buffers
    const windowStart = now();
    applyWindowCoefficients(frameData, windowCoeffsH, windowedH);
    applyWindowCoefficients(frameData, windowCoeffsDh, windowedDh);
    applyWindowCoefficients(frameData, windowCoeffsTh, windowedTh);
    windowingTime += elapsed(windowStart);

    // Zero-pad into reusable buffers
    const padStart = now();
    let fftInputH: Float32Array;
    let fftInputDh: Float32Array;
    let fftInputTh: Float32Array;

    if (paddedH && paddedDh && paddedTh) {
      paddedH.set(windowedH);
      paddedH.fill(0, windowSize);
      paddedDh.set(windowedDh);
      paddedDh.fill(0, windowSize);
      paddedTh.set(windowedTh);
      paddedTh.fill(0, windowSize);
      fftInputH = paddedH;
      fftInputDh = paddedDh;
      fftInputTh = paddedTh;
    } else {
      fftInputH = windowedH;
      fftInputDh = windowedDh;
      fftInputTh = windowedTh;
    }
    zeroPaddingTime += elapsed(padStart);

    // Run 3 FFTs
    const fftStart = now();
    const X_h = runFFT(fftContext, fftInputH, fftSize);
    const X_Dh = runFFT(fftContext, fftInputDh, fftSize);
    const X_Th = runFFT(fftContext, fftInputTh, fftSize);
    fftTime += elapsed(fftStart);

    // For each bin, compute reassigned coordinates (counted as magnitude/reassignment time)
    const magStart = now();
    for (let bin = dcBinsToSkip; bin < numBins; bin++) {
      const re_h = X_h[bin * 2];
      const im_h = X_h[bin * 2 + 1];
      const mag_h_sq = re_h * re_h + im_h * im_h;

      if (mag_h_sq < 1e-20) continue; // Skip very small magnitudes

      const mag_h = Math.sqrt(mag_h_sq);

      const re_Dh = X_Dh[bin * 2];
      const im_Dh = X_Dh[bin * 2 + 1];
      const re_Th = X_Th[bin * 2];
      const im_Th = X_Th[bin * 2 + 1];

      // Compute X_Dh / X_h (complex division)
      const ratio_Dh_im = (im_Dh * re_h - re_Dh * im_h) / mag_h_sq;

      // Compute X_Th / X_h
      const ratio_Th_re = (re_Th * re_h + im_Th * im_h) / mag_h_sq;

      // Instantaneous frequency correction (in bins)
      const freqCorrection = -ratio_Dh_im * freqCorrectionFactor;

      // Group delay / time correction (in frames)
      const timeCorrection = ratio_Th_re / hopSize;

      // Reassigned coordinates
      const reassignedBin = (bin + freqCorrection + 0.5) | 0; // Fast round
      const reassignedFrame = (frame + timeCorrection + 0.5) | 0;

      // Clamp to valid range
      if (
        reassignedBin >= dcBinsToSkip &&
        reassignedBin < numBins &&
        reassignedFrame >= 0 &&
        reassignedFrame < numFrames
      ) {
        const idx = reassignedFrame * numBins + reassignedBin;
        // Accumulate magnitude at reassigned location
        const normalizedMag = mag_h / normFactor;
        const db = magnitudeToDb(normalizedMag);
        const normalized = (db - gainOffset) / range;
        const value = normalized < 0 ? 0 : normalized > 1 ? 1 : normalized;

        // Use max instead of sum for cleaner visualization
        if (value > energyAccum[idx]) {
          energyAccum[idx] = value;
        }
      }
    }
    magnitudeTime += elapsed(magStart);
  }

  // Copy accumulated energy to spectrogram (counted as normalization)
  const normStart = now();
  spectrogram.set(energyAccum);
  normalizationTime = elapsed(normStart);

  return {
    spectrogram,
    numFrames,
    detailedTiming: {
      fftTime,
      windowingTime,
      zeroPaddingTime,
      magnitudeTime,
      normalizationTime,
      allocationTime,
      frameExtractionTime,
    },
  };
}

/**
 * Extended SpectrogramData with detailed timing
 */
export interface SpectrogramDataWithDetailedTiming extends SpectrogramData {
  detailedTiming: DetailedTiming;
}

/**
 * Generate spectrogram data from audio samples
 *
 * @param options - Spectrogram generation options
 * @returns Spectrogram data with timing information
 */
export function generateSpectrogram(
  options: SpectrogramOptions,
): SpectrogramDataWithDetailedTiming {
  const {
    samples,
    sampleRate,
    fftContext,
    zeroPadding = 1,
    gain = 0,
    range = 80,
    algorithm = "standard",
    targetWidth,
  } = options;
  const windowType: WindowType = options.windowType ?? "hann";

  const fftSize = fftContext.size;
  const windowSize = Math.floor(fftSize / zeroPadding);
  const numBins = fftSize / 2 + 1;

  // Calculate hop size, optionally capped by targetWidth
  let hopSize = options.hopSize ?? Math.floor(fftSize / 4);
  if (targetWidth && targetWidth > 0) {
    // If user's hopSize would produce more frames than targetWidth, increase hopSize
    const framesWithUserHop = Math.floor((samples.length - windowSize) / hopSize) + 1;
    if (framesWithUserHop > targetWidth) {
      const minHopSize = Math.floor((samples.length - windowSize) / Math.max(1, targetWidth - 1));
      hopSize = Math.max(hopSize, minHopSize);
    }
  }

  const startTime = now();

  let result: {
    spectrogram: Float32Array;
    numFrames: number;
    detailedTiming: Omit<DetailedTiming, "totalTime" | "fftsPerSecond">;
  };

  if (algorithm === "reassignment") {
    result = generateReassignedSpectrogram(
      samples,
      sampleRate,
      fftContext,
      hopSize,
      windowType,
      zeroPadding,
      gain,
      range,
    );
  } else {
    result = generateStandardSpectrogram(
      samples,
      sampleRate,
      fftContext,
      hopSize,
      windowType,
      zeroPadding,
      gain,
      range,
    );
  }

  const totalTime = elapsed(startTime);

  // For reassignment, we run 3x as many FFTs
  const effectiveFFTs = algorithm === "reassignment" ? result.numFrames * 3 : result.numFrames;

  const detailedTiming: DetailedTiming = {
    ...result.detailedTiming,
    totalTime,
    fftsPerSecond: (effectiveFFTs / result.detailedTiming.fftTime) * 1000,
  };

  return {
    data: result.spectrogram,
    numFrames: result.numFrames,
    numBins,
    fftSize,
    windowSize,
    hopSize,
    sampleRate,
    duration: samples.length / sampleRate,
    timing: {
      fftTime: result.detailedTiming.fftTime,
      totalTime,
      fftsPerSecond: detailedTiming.fftsPerSecond,
    },
    detailedTiming,
  };
}

/**
 * Analyze spectrogram to find the frequency range with actual content
 * Returns suggested min/max frequencies based on energy distribution
 */
export function analyzeFrequencyRange(spectrogram: SpectrogramData): FrequencyRange {
  const { data, numFrames, numBins, sampleRate } = spectrogram;
  const nyquist = sampleRate / 2;

  // Compute average energy per frequency bin across all frames
  const avgEnergy = new Float32Array(numBins);
  for (let bin = 0; bin < numBins; bin++) {
    let sum = 0;
    for (let frame = 0; frame < numFrames; frame++) {
      sum += data[frame * numBins + bin];
    }
    avgEnergy[bin] = sum / numFrames;
  }

  // Find the max energy and its location
  let maxEnergy = 0;
  let peakBin = 0;
  for (let bin = 0; bin < numBins; bin++) {
    if (avgEnergy[bin] > maxEnergy) {
      maxEnergy = avgEnergy[bin];
      peakBin = bin;
    }
  }

  if (maxEnergy === 0) {
    return { minFreq: 20, maxFreq: nyquist };
  }

  // Calculate noise floor as the median of the upper 25% of bins
  const upperBins = avgEnergy.slice(Math.floor(numBins * 0.75));
  const sortedUpper = [...upperBins].sort((a, b) => a - b);
  const noiseFloor = sortedUpper[Math.floor(sortedUpper.length / 2)];

  // Threshold is noise floor + 5% of the dynamic range above noise
  const dynamicRange = maxEnergy - noiseFloor;
  const threshold = noiseFloor + dynamicRange * 0.05;

  // Find lowest bin with energy above threshold (start from DC, skip first few bins)
  let minBin = 3;
  for (let bin = 3; bin < peakBin; bin++) {
    if (avgEnergy[bin] > threshold) {
      minBin = bin;
      break;
    }
  }

  // Find highest bin with energy above threshold (search down from top)
  let maxBin = numBins - 1;
  for (let bin = numBins - 1; bin > peakBin; bin--) {
    if (avgEnergy[bin] > threshold) {
      maxBin = bin;
      break;
    }
  }

  // Convert bins to frequencies
  const binToHz = (bin: number) => (bin / (numBins - 1)) * nyquist;
  let minFreq = Math.floor(binToHz(minBin) / 10) * 10;
  let maxFreq = Math.ceil(binToHz(maxBin) / 100) * 100;

  // Ensure reasonable bounds
  minFreq = Math.max(20, minFreq);
  maxFreq = Math.min(nyquist, maxFreq);
  maxFreq = Math.max(minFreq + 500, maxFreq);

  return { minFreq, maxFreq };
}
