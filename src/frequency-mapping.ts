import type { FrequencyScale } from "./types";

/**
 * Convert Hz to Mel scale
 */
export function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700);
}

/**
 * Convert Mel scale to Hz
 */
export function melToHz(mel: number): number {
  return 700 * (Math.pow(10, mel / 2595) - 1);
}

/**
 * Convert Hz to Bark scale
 * Bark scale is a psychoacoustical scale based on subjective loudness measurements
 */
export function hzToBark(hz: number): number {
  return 13 * Math.atan(0.00076 * hz) + 3.5 * Math.atan(Math.pow(hz / 7500, 2));
}

/**
 * Convert Bark scale to Hz
 */
export function barkToHz(bark: number): number {
  // Inverse approximation using Newton-Raphson iteration
  let hz = bark * 100; // Initial guess
  for (let i = 0; i < 10; i++) {
    const currentBark = hzToBark(hz);
    const error = bark - currentBark;
    if (Math.abs(error) < 0.001) break;
    // Derivative approximation
    const derivative =
      (13 * 0.00076) / (1 + Math.pow(0.00076 * hz, 2)) +
      (3.5 * 2 * (hz / 7500)) / (7500 * (1 + Math.pow(hz / 7500, 4)));
    hz += error / derivative;
  }
  return Math.max(1, hz);
}

/**
 * Convert Hz to ERB (Equivalent Rectangular Bandwidth) scale
 * ERB gives an approximation to the bandwidths of filters in human hearing
 */
export function hzToErb(hz: number): number {
  return 21.4 * Math.log10(1 + 0.00437 * hz);
}

/**
 * Convert ERB scale to Hz
 */
export function erbToHz(erb: number): number {
  return (Math.pow(10, erb / 21.4) - 1) / 0.00437;
}

/**
 * Create frequency bin mapping for different scales
 */
export function createFrequencyMapping(
  numBins: number,
  sampleRate: number,
  scale: FrequencyScale,
  displayBins: number,
  minFreq?: number,
  maxFreq?: number,
): Float32Array {
  const nyquist = sampleRate / 2;
  const effectiveMinFreq = Math.max(minFreq ?? 20, 1);
  const effectiveMaxFreq = Math.min(maxFreq ?? nyquist, nyquist);

  const mapping = new Float32Array(displayBins);

  if (scale === "linear") {
    for (let i = 0; i < displayBins; i++) {
      const hz = effectiveMinFreq + (i / (displayBins - 1)) * (effectiveMaxFreq - effectiveMinFreq);
      mapping[i] = (hz / nyquist) * (numBins - 1);
    }
  } else if (scale === "log") {
    const logMin = Math.log10(effectiveMinFreq);
    const logMax = Math.log10(effectiveMaxFreq);

    for (let i = 0; i < displayBins; i++) {
      const logHz = logMin + (i / (displayBins - 1)) * (logMax - logMin);
      const hz = Math.pow(10, logHz);
      mapping[i] = (hz / nyquist) * (numBins - 1);
    }
  } else if (scale === "mel") {
    const minMel = hzToMel(effectiveMinFreq);
    const maxMel = hzToMel(effectiveMaxFreq);

    for (let i = 0; i < displayBins; i++) {
      const mel = minMel + (i / (displayBins - 1)) * (maxMel - minMel);
      const hz = melToHz(mel);
      mapping[i] = (hz / nyquist) * (numBins - 1);
    }
  } else if (scale === "bark") {
    const minBark = hzToBark(effectiveMinFreq);
    const maxBark = hzToBark(effectiveMaxFreq);

    for (let i = 0; i < displayBins; i++) {
      const bark = minBark + (i / (displayBins - 1)) * (maxBark - minBark);
      const hz = barkToHz(bark);
      mapping[i] = (hz / nyquist) * (numBins - 1);
    }
  } else if (scale === "erb") {
    const minErb = hzToErb(effectiveMinFreq);
    const maxErb = hzToErb(effectiveMaxFreq);

    for (let i = 0; i < displayBins; i++) {
      const erb = minErb + (i / (displayBins - 1)) * (maxErb - minErb);
      const hz = erbToHz(erb);
      mapping[i] = (hz / nyquist) * (numBins - 1);
    }
  }

  return mapping;
}

/**
 * Interpolate spectrum using frequency mapping
 */
export function remapSpectrum(
  spectrum: Float32Array,
  mapping: Float32Array,
  displayBins: number,
): Float32Array {
  const remapped = new Float32Array(displayBins);

  for (let i = 0; i < displayBins; i++) {
    const srcBin = mapping[i];
    const binLow = Math.floor(srcBin);
    const binHigh = Math.min(binLow + 1, spectrum.length - 1);
    const frac = srcBin - binLow;

    // Linear interpolation between bins
    remapped[i] = spectrum[binLow] * (1 - frac) + spectrum[binHigh] * frac;
  }

  return remapped;
}
