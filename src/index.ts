// Types
export type {
  FFTContext,
  WindowType,
  FrequencyScale,
  ColorScale,
  SpectrogramAlgorithm,
  DownsampleMode,
  InterpolationMode,
  SpectrogramOptions,
  SpectrogramData,
  SpectrogramTiming,
  RenderOptions,
  FrequencyRange,
  RGB,
  WindowFunction,
  ColorScaleFunction,
} from "./types";

// Core spectrogram functions
export { generateSpectrogram, analyzeFrequencyRange } from "./spectrogram";
export type { DetailedTiming, SpectrogramDataWithDetailedTiming } from "./spectrogram";

// Rendering
export { renderSpectrogram, renderToImageData } from "./renderer";
export type { RenderTiming, RenderResult } from "./renderer";

// Window functions
export {
  WINDOW_FUNCTIONS,
  WINDOW_DERIVATIVES,
  WINDOW_TIME_RAMPED,
  WINDOW_COHERENT_GAIN,
  applyWindow,
  zeroPad,
  getWindowCoefficients,
  applyWindowCoefficients,
  clearWindowCache,
} from "./window-functions";

// Color scales
export { COLOR_SCALES } from "./color-scales";

// Frequency mapping utilities
export {
  hzToMel,
  melToHz,
  hzToBark,
  barkToHz,
  hzToErb,
  erbToHz,
  createFrequencyMapping,
  remapSpectrum,
} from "./frequency-mapping";
