/**
 * FFT Context interface - any FFT library must implement this
 */
export interface FFTContext {
  /** FFT size (must be power of 2) */
  size: number;
  /** Whether this is a real-only FFT (vs complex) */
  isReal: boolean;
  /** Get the input buffer to write samples to */
  getInputBuffer(): Float32Array | Float64Array;
  /** Get the output buffer after FFT execution */
  getOutputBuffer(): Float32Array | Float64Array;
  /** Execute the FFT */
  run(): void;
}

/**
 * Window function types
 */
export type WindowType = "hann" | "hamming" | "blackman" | "blackmanHarris" | "rectangular";

/**
 * Spectrogram algorithm types
 */
export type SpectrogramAlgorithm = "standard" | "reassignment";

/**
 * Downsampling mode when display is smaller than data
 */
export type DownsampleMode = "max" | "average" | "nearest";

/**
 * Interpolation mode for frequency bin mapping
 */
export type InterpolationMode = "nearest" | "linear" | "cubic";

/**
 * Frequency scale types
 */
export type FrequencyScale = "linear" | "log" | "mel" | "bark" | "erb";

/**
 * Color scale types
 */
export type ColorScale = "viridis" | "magma" | "grayscale" | "hot" | "inferno";

/**
 * Options for spectrogram generation
 */
export interface SpectrogramOptions {
  /** Audio samples (mono) */
  samples: Float32Array;
  /** Sample rate in Hz */
  sampleRate: number;
  /** FFT context implementing the FFTContext interface */
  fftContext: FFTContext;
  /** Hop size between frames (defaults to fftSize / 4) */
  hopSize?: number;
  /** Window function type */
  windowType?: WindowType;
  /** Zero padding factor (1, 2, 4, etc.) */
  zeroPadding?: number;
  /** Gain in dB (white point - signals at this level appear white, default -20 to match Audacity's visual appearance) */
  gain?: number;
  /** Dynamic range in dB (default 80) */
  range?: number;
  /** Algorithm to use (default "standard") */
  algorithm?: SpectrogramAlgorithm;
  /** Target output width in pixels - adjusts hop size to produce ~this many frames */
  targetWidth?: number;
}

/**
 * Timing information from spectrogram generation
 */
export interface SpectrogramTiming {
  /** Time spent on FFT operations in ms */
  fftTime: number;
  /** Total processing time in ms */
  totalTime: number;
  /** FFTs computed per second */
  fftsPerSecond: number;
}

/**
 * Result from spectrogram generation
 */
export interface SpectrogramData {
  /** Normalized spectrogram data (0-1 range) */
  data: Float32Array;
  /** Number of time frames */
  numFrames: number;
  /** Number of frequency bins */
  numBins: number;
  /** FFT size used */
  fftSize: number;
  /** Window size (before zero padding) */
  windowSize: number;
  /** Hop size between frames */
  hopSize: number;
  /** Sample rate */
  sampleRate: number;
  /** Duration in seconds */
  duration: number;
  /** Timing information */
  timing: SpectrogramTiming;
}

/**
 * Options for spectrogram rendering
 */
export interface RenderOptions {
  /** Target canvas element */
  canvas: HTMLCanvasElement;
  /** Spectrogram data from generateSpectrogram */
  spectrogram: SpectrogramData;
  /** Color scale to use */
  colorScale?: ColorScale;
  /** Frequency scale to use */
  freqScale?: FrequencyScale;
  /** Minimum frequency to display (Hz) */
  minFreq?: number;
  /** Maximum frequency to display (Hz) */
  maxFreq?: number;
  /** Frequency gain in dB/decade - boosts higher frequencies for visibility (default 0) */
  frequencyGain?: number;
  /** Dynamic range in dB used during spectrogram generation (default 80, needed for frequency gain scaling) */
  range?: number;
  /** How to combine bins when display is smaller than data (default "max") */
  downsampleMode?: DownsampleMode;
  /** Interpolation mode for frequency mapping (default "linear") */
  interpolation?: InterpolationMode;
  /** Target output width in pixels (default: use spectrogram numFrames) */
  outputWidth?: number;
  /** Target output height in pixels (default: use spectrogram numBins) */
  outputHeight?: number;
}

/**
 * Frequency range analysis result
 */
export interface FrequencyRange {
  /** Suggested minimum frequency in Hz */
  minFreq: number;
  /** Suggested maximum frequency in Hz */
  maxFreq: number;
}

/**
 * RGB color tuple
 */
export type RGB = [number, number, number];

/**
 * Window function signature
 */
export type WindowFunction = (i: number, N: number) => number;

/**
 * Color scale function signature
 */
export type ColorScaleFunction = (t: number) => RGB;
