import {
  generateSpectrogram,
  renderSpectrogram,
  analyzeFrequencyRange,
  type SpectrogramData,
  type WindowType,
  type ColorScale,
  type FrequencyScale,
  type SpectrogramAlgorithm,
  type DownsampleMode,
  type InterpolationMode,
} from "@emnudge/spectrogram";
import { createWatFFTContext } from "./fft-context";

// =============================================================================
// DOM Helpers
// =============================================================================

function getElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

// =============================================================================
// Toast Notification System
// =============================================================================

const toastContainer = getElement<HTMLDivElement>("toastContainer");

type ToastType = "error" | "warning" | "success" | "info";

const toastIcons: Record<ToastType, string> = {
  error: "\u2716",
  warning: "\u26A0",
  success: "\u2714",
  info: "\u2139",
};

function showToast(type: ToastType, message: string, options: { title?: string; duration?: number } = {}) {
  const { title, duration = 5000 } = options;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  toast.innerHTML = `
    <span class="toast-icon">${toastIcons[type]}</span>
    <div class="toast-content">
      ${title ? `<div class="toast-title">${title}</div>` : ""}
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close">\u00D7</button>
  `;

  toast.querySelector(".toast-close")!.addEventListener("click", () => dismissToast(toast));
  toastContainer.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => dismissToast(toast), duration);
  }
}

function dismissToast(toast: HTMLElement) {
  if (!toast.parentNode) return;
  toast.classList.add("toast-out");
  toast.addEventListener("animationend", () => toast.remove());
}

function showError(message: string, title = "Error") {
  showToast("error", message, { title });
}

// =============================================================================
// Control System
// =============================================================================

type ControlDef =
  | { type: "section"; label: string }
  | { type: "file"; id: string; label: string; accept: string }
  | { type: "button"; id: string; label: string }
  | { type: "select"; id: string; label: string; options: { value: string; label: string }[]; defaultValue: string; onChange: "reprocess" | "rerender" | "custom" }
  | { type: "range"; id: string; label: string; min: number; max: number; step: number; defaultValue: number; format?: (v: number) => string; onChange: "reprocess" | "rerender" }
  | { type: "steppedRange"; id: string; label: string; values: number[]; labels: string[]; defaultIndex: number; onChange: "reprocess" | "rerender" };

const controlDefs: ControlDef[] = [
  { type: "file", id: "audioFile", label: "Audio Source", accept: "audio/*" },
  { type: "button", id: "generateSynth", label: "Generate Test Tone" },

  { type: "section", label: "Analysis" },

  { type: "select", id: "algorithm", label: "Algorithm", options: [
    { value: "standard", label: "Standard" },
    { value: "reassignment", label: "Reassignment" },
  ], defaultValue: "standard", onChange: "reprocess" },

  { type: "steppedRange", id: "fftSize", label: "FFT Size", values: [256, 512, 1024, 2048, 4096], labels: ["256", "512", "1024", "2048", "4096"], defaultIndex: 3, onChange: "reprocess" },

  { type: "select", id: "windowType", label: "Window Function", options: [
    { value: "hann", label: "Hann" },
    { value: "hamming", label: "Hamming" },
    { value: "blackman", label: "Blackman" },
    { value: "blackmanHarris", label: "Blackman-Harris" },
    { value: "rectangular", label: "Rectangular" },
  ], defaultValue: "hann", onChange: "reprocess" },

  { type: "steppedRange", id: "zeroPadding", label: "Zero Padding", values: [1, 2, 4, 8], labels: ["1x", "2x", "4x", "8x"], defaultIndex: 0, onChange: "reprocess" },

  { type: "steppedRange", id: "overlap", label: "Overlap", values: [0.5, 0.75, 0.875, 0.9375], labels: ["50%", "75%", "87.5%", "93.75%"], defaultIndex: 3, onChange: "reprocess" },

  { type: "range", id: "gain", label: "Gain (dB)", min: -40, max: 60, step: 1, defaultValue: 20, onChange: "reprocess" },

  { type: "range", id: "range", label: "Range (dB)", min: 20, max: 120, step: 1, defaultValue: 80, onChange: "reprocess" },

  { type: "section", label: "Display" },

  { type: "select", id: "colorScale", label: "Color Scale", options: [
    { value: "magma", label: "Magma" },
    { value: "viridis", label: "Viridis" },
    { value: "inferno", label: "Inferno" },
    { value: "hot", label: "Hot" },
    { value: "grayscale", label: "Grayscale" },
  ], defaultValue: "magma", onChange: "rerender" },

  { type: "select", id: "freqScale", label: "Frequency Scale", options: [
    { value: "mel", label: "Mel" },
    { value: "log", label: "Logarithmic" },
    { value: "linear", label: "Linear" },
    { value: "bark", label: "Bark" },
    { value: "erb", label: "ERB" },
  ], defaultValue: "mel", onChange: "rerender" },

  { type: "range", id: "minFreq", label: "Min Freq (Hz)", min: 0, max: 8000, step: 10, defaultValue: 0, onChange: "rerender" },

  { type: "range", id: "maxFreq", label: "Max Freq (Hz)", min: 1000, max: 22050, step: 10, defaultValue: 22050, onChange: "rerender" },

  { type: "range", id: "freqGain", label: "Freq Gain (dB/dec)", min: 0, max: 20, step: 1, defaultValue: 0, onChange: "rerender" },

  { type: "select", id: "downsampleMode", label: "Bin Combine Mode", options: [
    { value: "max", label: "Max (peaks visible)" },
    { value: "average", label: "Average" },
    { value: "nearest", label: "Nearest (fast)" },
  ], defaultValue: "max", onChange: "rerender" },

  { type: "select", id: "interpolation", label: "Interpolation", options: [
    { value: "nearest", label: "Nearest" },
    { value: "linear", label: "Linear" },
    { value: "cubic", label: "Cubic" },
  ], defaultValue: "cubic", onChange: "rerender" },
];

// Control state storage
type ControlInput = HTMLInputElement | HTMLSelectElement | HTMLButtonElement;
const controls: Record<string, { input: ControlInput; valueSpan?: HTMLSpanElement; def: ControlDef }> = {};

function buildControls() {
  const container = document.getElementById("controls")!;

  for (const def of controlDefs) {
    if (def.type === "section") {
      const section = document.createElement("div");
      section.className = "section-title";
      section.textContent = def.label;
      container.appendChild(section);
      continue;
    }

    const group = document.createElement("div");
    group.className = "control-group";

    if (def.type === "file") {
      const input = document.createElement("input");
      input.type = "file";
      input.id = def.id;
      input.accept = def.accept;

      const label = document.createElement("label");
      label.textContent = def.label;

      const fileLabel = document.createElement("label");
      fileLabel.className = "file-label";
      fileLabel.htmlFor = def.id;
      fileLabel.textContent = "Choose File";

      group.appendChild(label);
      const buttonsDiv = document.createElement("div");
      buttonsDiv.className = "audio-buttons";
      buttonsDiv.appendChild(input);
      buttonsDiv.appendChild(fileLabel);
      group.appendChild(buttonsDiv);

      controls[def.id] = { input, def };
    } else if (def.type === "button") {
      const button = document.createElement("button");
      button.id = def.id;
      button.textContent = def.label;

      // Append to previous audio-buttons div if it exists
      const prevGroup = container.lastElementChild;
      const audioButtons = prevGroup?.querySelector(".audio-buttons");
      if (audioButtons) {
        audioButtons.appendChild(button);
        controls[def.id] = { input: button, def };
        continue;
      }

      group.appendChild(button);
      controls[def.id] = { input: button, def };
    } else if (def.type === "select") {
      const label = document.createElement("label");
      label.textContent = def.label;

      const select = document.createElement("select");
      select.id = def.id;
      for (const opt of def.options) {
        const option = document.createElement("option");
        option.value = opt.value;
        option.textContent = opt.label;
        if (opt.value === def.defaultValue) option.selected = true;
        select.appendChild(option);
      }

      group.appendChild(label);
      group.appendChild(select);
      controls[def.id] = { input: select, def };

      if (def.onChange === "reprocess") {
        select.addEventListener("change", () => {
          processAndRender();
          pushUndoState();
        });
      } else if (def.onChange === "rerender") {
        select.addEventListener("change", () => {
          rerender();
          pushUndoState();
        });
      }
    } else if (def.type === "range") {
      const label = document.createElement("label");
      label.textContent = def.label + " ";

      const valueSpan = document.createElement("span");
      valueSpan.className = "range-value";
      valueSpan.textContent = def.format ? def.format(def.defaultValue) : def.defaultValue.toString();
      label.appendChild(valueSpan);

      const input = document.createElement("input");
      input.type = "range";
      input.id = def.id;
      input.min = def.min.toString();
      input.max = def.max.toString();
      input.step = def.step.toString();
      input.value = def.defaultValue.toString();

      group.appendChild(label);
      group.appendChild(input);
      controls[def.id] = { input, valueSpan, def };

      input.addEventListener("input", () => {
        valueSpan.textContent = def.format ? def.format(parseFloat(input.value)) : input.value;
        if (def.onChange === "reprocess") processAndRender();
        else if (def.onChange === "rerender") rerender();
      });

      // Push undo state on mouseup (action complete)
      input.addEventListener("mouseup", pushUndoState);
      input.addEventListener("keyup", pushUndoState);
    } else if (def.type === "steppedRange") {
      const label = document.createElement("label");
      label.textContent = def.label + " ";

      const valueSpan = document.createElement("span");
      valueSpan.className = "range-value";
      valueSpan.textContent = def.labels[def.defaultIndex];
      label.appendChild(valueSpan);

      const input = document.createElement("input");
      input.type = "range";
      input.id = def.id;
      input.min = "0";
      input.max = (def.values.length - 1).toString();
      input.step = "1";
      input.value = def.defaultIndex.toString();

      group.appendChild(label);
      group.appendChild(input);
      controls[def.id] = { input, valueSpan, def };

      input.addEventListener("input", () => {
        const idx = parseInt(input.value);
        valueSpan.textContent = def.labels[idx];
        if (def.onChange === "reprocess") processAndRender();
        else if (def.onChange === "rerender") rerender();
      });

      // Push undo state on mouseup (action complete)
      input.addEventListener("mouseup", pushUndoState);
      input.addEventListener("keyup", pushUndoState);
    }

    container.appendChild(group);
  }
}

// Helper functions to get control values
function getSelectValue(id: string): string {
  const input = controls[id].input;
  if (input instanceof HTMLSelectElement) {
    return input.value;
  }
  throw new Error(`Control ${id} is not a select element`);
}

function getRangeValue(id: string): number {
  const input = controls[id].input;
  if (input instanceof HTMLInputElement) {
    return parseFloat(input.value);
  }
  throw new Error(`Control ${id} is not an input element`);
}

function getSteppedValue(id: string): number {
  const ctrl = controls[id];
  const def = ctrl.def;
  if (def.type !== "steppedRange") {
    throw new Error(`Control ${id} is not a stepped range`);
  }
  const input = ctrl.input;
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Control ${id} is not an input element`);
  }
  const idx = parseInt(input.value);
  return def.values[idx];
}

function setRangeValue(id: string, value: number) {
  const ctrl = controls[id];
  const input = ctrl.input;
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Control ${id} is not an input element`);
  }
  input.value = value.toString();
  if (ctrl.valueSpan) {
    const def = ctrl.def;
    if (def.type === "range") {
      ctrl.valueSpan.textContent = def.format ? def.format(value) : value.toString();
    }
  }
}

function setRangeMax(id: string, max: number) {
  const input = controls[id].input;
  if (!(input instanceof HTMLInputElement)) {
    throw new Error(`Control ${id} is not an input element`);
  }
  input.max = max.toString();
}

// Type-safe enum getters with runtime validation
const colorScales = new Set<ColorScale>(["viridis", "magma", "grayscale", "hot", "inferno"]);
const freqScales = new Set<FrequencyScale>(["linear", "log", "mel", "bark", "erb"]);
const downsampleModes = new Set<DownsampleMode>(["max", "average", "nearest"]);
const interpolationModes = new Set<InterpolationMode>(["nearest", "linear", "cubic"]);
const windowTypes = new Set<WindowType>(["hann", "hamming", "blackman", "blackmanHarris", "rectangular"]);
const algorithms = new Set<SpectrogramAlgorithm>(["standard", "reassignment"]);

function getColorScale(id: string): ColorScale {
  const value = getSelectValue(id);
  if (!colorScales.has(value as ColorScale)) {
    throw new Error(`Invalid color scale: ${value}`);
  }
  return value as ColorScale;
}

function getFreqScale(id: string): FrequencyScale {
  const value = getSelectValue(id);
  if (!freqScales.has(value as FrequencyScale)) {
    throw new Error(`Invalid frequency scale: ${value}`);
  }
  return value as FrequencyScale;
}

function getDownsampleMode(id: string): DownsampleMode {
  const value = getSelectValue(id);
  if (!downsampleModes.has(value as DownsampleMode)) {
    throw new Error(`Invalid downsample mode: ${value}`);
  }
  return value as DownsampleMode;
}

function getInterpolationMode(id: string): InterpolationMode {
  const value = getSelectValue(id);
  if (!interpolationModes.has(value as InterpolationMode)) {
    throw new Error(`Invalid interpolation mode: ${value}`);
  }
  return value as InterpolationMode;
}

function getWindowType(id: string): WindowType {
  const value = getSelectValue(id);
  if (!windowTypes.has(value as WindowType)) {
    throw new Error(`Invalid window type: ${value}`);
  }
  return value as WindowType;
}

function getAlgorithm(id: string): SpectrogramAlgorithm {
  const value = getSelectValue(id);
  if (!algorithms.has(value as SpectrogramAlgorithm)) {
    throw new Error(`Invalid algorithm: ${value}`);
  }
  return value as SpectrogramAlgorithm;
}

// =============================================================================
// DOM Elements
// =============================================================================

const canvas = getElement<HTMLCanvasElement>("spectrogram");
const statusEl = getElement<HTMLDivElement>("status");
const infoEl = getElement<HTMLDivElement>("info");

const durationSpan = getElement<HTMLSpanElement>("duration");
const sampleRateSpan = getElement<HTMLSpanElement>("sampleRate");
const framesSpan = getElement<HTMLSpanElement>("frames");
const fftTimeSpan = getElement<HTMLSpanElement>("fftTime");
const fftsPerSecSpan = getElement<HTMLSpanElement>("fftsPerSec");

// =============================================================================
// State
// =============================================================================

let currentSamples: Float32Array | null = null;
let currentSampleRate = 44100;
let currentSpectrogram: SpectrogramData | null = null;

// Zoom state - track original samples and zoom stack
let originalSamples: Float32Array | null = null;
let zoomStack: { startSample: number; endSample: number }[] = [];

// =============================================================================
// Undo System
// =============================================================================

interface UndoState {
  // Control values
  controlValues: Record<string, string>;
  // Zoom state
  zoomStack: { startSample: number; endSample: number }[];
  // Canvas size
  isCustomSize: boolean;
  customWidth: number;
  customHeight: number;
}

const undoStack: UndoState[] = [];
const MAX_UNDO_STATES = 10;
let isRestoringState = false;

function captureState(): UndoState {
  const controlValues: Record<string, string> = {};
  for (const [id, ctrl] of Object.entries(controls)) {
    if (ctrl.input instanceof HTMLSelectElement || ctrl.input instanceof HTMLInputElement) {
      controlValues[id] = ctrl.input.value;
    }
  }

  return {
    controlValues,
    zoomStack: [...zoomStack],
    isCustomSize,
    customWidth,
    customHeight,
  };
}

function pushUndoState() {
  if (isRestoringState) return;

  const state = captureState();
  undoStack.push(state);

  // Keep max 10 states
  while (undoStack.length > MAX_UNDO_STATES) {
    undoStack.shift();
  }

  updateUndoIndicator();
}

function restoreState(state: UndoState) {
  isRestoringState = true;

  try {
    // Restore control values
    for (const [id, value] of Object.entries(state.controlValues)) {
      const ctrl = controls[id];
      if (!ctrl) continue;

      if (ctrl.input instanceof HTMLSelectElement || ctrl.input instanceof HTMLInputElement) {
        ctrl.input.value = value;

        // Update value display for ranges
        if (ctrl.valueSpan) {
          const def = ctrl.def;
          if (def.type === "range") {
            ctrl.valueSpan.textContent = def.format
              ? def.format(parseFloat(value))
              : value;
          } else if (def.type === "steppedRange") {
            const idx = parseInt(value);
            ctrl.valueSpan.textContent = def.labels[idx];
          }
        }
      }
    }

    // Restore canvas size
    if (state.isCustomSize) {
      setCustomSize(state.customWidth, state.customHeight);
    } else {
      resetSize();
    }

    // Restore zoom state
    zoomStack = [...state.zoomStack];
    if (originalSamples) {
      if (zoomStack.length > 0) {
        const lastZoom = zoomStack[zoomStack.length - 1];
        currentSamples = originalSamples.slice(lastZoom.startSample, lastZoom.endSample);
      } else {
        currentSamples = originalSamples;
      }
    }
    updateZoomIndicator();

    // Reprocess with restored settings
    processAndRender();
  } finally {
    isRestoringState = false;
  }
}

function undo() {
  if (undoStack.length < 2) return; // Need at least 2 states (current + previous)

  // Pop current state
  undoStack.pop();

  // Get previous state
  const previousState = undoStack[undoStack.length - 1];
  if (previousState) {
    restoreState(previousState);
  }

  updateUndoIndicator();
}

function updateUndoIndicator() {
  const indicator = document.getElementById("undoIndicator");
  if (indicator) {
    const count = Math.max(0, undoStack.length - 1);
    indicator.textContent = `Undo: ${count}`;
    indicator.style.display = count > 0 ? "block" : "none";
  }
}

function getZoomLevel(): number {
  return zoomStack.length;
}

function isZoomed(): boolean {
  return zoomStack.length > 0;
}

function updateZoomIndicator() {
  const zoomIndicator = getElement<HTMLDivElement>("zoomIndicator");
  const resetZoomBtn = getElement<HTMLButtonElement>("resetZoomBtn");

  if (isZoomed() && originalSamples && currentSamples) {
    const totalDuration = originalSamples.length / currentSampleRate;
    const currentDuration = currentSamples.length / currentSampleRate;
    const zoomRatio = totalDuration / currentDuration;
    zoomIndicator.textContent = `Zoom: ${zoomRatio.toFixed(1)}x (${currentDuration.toFixed(2)}s)`;
    zoomIndicator.style.display = "block";
    resetZoomBtn.style.display = "block";
  } else {
    zoomIndicator.style.display = "none";
    resetZoomBtn.style.display = "none";
  }
}

function zoomToRegion(startX: number, endX: number) {
  if (!currentSamples || !currentSpectrogram) return;

  const canvasRect = canvas.getBoundingClientRect();
  const canvasWidth = canvasRect.width;

  // Convert pixel positions to normalized positions (0-1)
  const startNorm = Math.min(startX, endX) / canvasWidth;
  const endNorm = Math.max(startX, endX) / canvasWidth;

  // Don't zoom if selection is too small
  if (endNorm - startNorm < 0.02) return;

  // Convert to sample indices
  const numSamples = currentSamples.length;
  const startSample = Math.floor(startNorm * numSamples);
  const endSample = Math.ceil(endNorm * numSamples);

  // Minimum selection size
  if (endSample - startSample < 1000) return;

  // Store original samples on first zoom
  if (!originalSamples) {
    originalSamples = currentSamples;
  }

  // Push current view to stack (relative to original)
  let absoluteStart = startSample;
  let absoluteEnd = endSample;
  if (zoomStack.length > 0) {
    const lastZoom = zoomStack[zoomStack.length - 1];
    const currentLength = lastZoom.endSample - lastZoom.startSample;
    absoluteStart = lastZoom.startSample + Math.floor(startNorm * currentLength);
    absoluteEnd = lastZoom.startSample + Math.ceil(endNorm * currentLength);
  }
  zoomStack.push({ startSample: absoluteStart, endSample: absoluteEnd });

  // Slice to zoomed region
  currentSamples = originalSamples.slice(absoluteStart, absoluteEnd);

  updateZoomIndicator();
  processAndRender();
  pushUndoState();
}

function resetZoom() {
  if (!originalSamples) return;

  currentSamples = originalSamples;
  zoomStack = [];

  updateZoomIndicator();
  processAndRender();
  pushUndoState();
}

// =============================================================================
// Core Functions
// =============================================================================

function setStatus(message: string) {
  statusEl.textContent = message;
}

function updateInfo(spectrogram: SpectrogramData) {
  infoEl.style.display = "flex";
  durationSpan.textContent = `${spectrogram.duration.toFixed(2)}s`;
  sampleRateSpan.textContent = `${spectrogram.sampleRate} Hz`;
  framesSpan.textContent = spectrogram.numFrames.toString();
  fftTimeSpan.textContent = `${spectrogram.timing.fftTime.toFixed(1)}ms`;
  fftsPerSecSpan.textContent = spectrogram.timing.fftsPerSecond.toFixed(0);
}

function updateFreqSliderRanges(sampleRate: number) {
  const nyquist = Math.floor(sampleRate / 2);
  setRangeMax("minFreq", Math.floor(nyquist * 0.9));
  setRangeMax("maxFreq", nyquist);
}

function setFreqRange(minFreq: number, maxFreq: number) {
  setRangeValue("minFreq", minFreq);
  setRangeValue("maxFreq", maxFreq);
}

function getRenderOptions() {
  return {
    colorScale: getColorScale("colorScale"),
    freqScale: getFreqScale("freqScale"),
    minFreq: getRangeValue("minFreq"),
    maxFreq: getRangeValue("maxFreq"),
    frequencyGain: getRangeValue("freqGain"),
    downsampleMode: getDownsampleMode("downsampleMode"),
    interpolation: getInterpolationMode("interpolation"),
  };
}

function rerender() {
  if (!currentSpectrogram) return;

  renderSpectrogram({
    canvas,
    spectrogram: currentSpectrogram,
    ...getRenderOptions(),
  });
}

async function processAndRender() {
  if (!currentSamples) return;

  const algorithm = getAlgorithm("algorithm");
  const fftSize = getSteppedValue("fftSize");
  const zeroPadding = getSteppedValue("zeroPadding");
  const windowType = getWindowType("windowType");
  const gain = getRangeValue("gain");
  const range = getRangeValue("range");
  const overlap = getSteppedValue("overlap");

  const effectiveFftSize = fftSize * zeroPadding;
  const windowSize = fftSize;
  const hopSize = Math.floor(windowSize * (1 - overlap));

  setStatus(algorithm === "reassignment" ? "Creating FFT context (3x FFTs)..." : "Creating FFT context...");

  try {
    const fftContext = await createWatFFTContext(effectiveFftSize);

    setStatus(algorithm === "reassignment" ? "Generating reassigned spectrogram..." : "Generating spectrogram...");

    // Cap frames at 4000 for performance, but don't reduce below what hopSize would give
    // This provides good detail while preventing huge frame counts for long files
    const maxFrames = 4000;

    currentSpectrogram = generateSpectrogram({
      samples: currentSamples,
      sampleRate: currentSampleRate,
      fftContext,
      hopSize,
      windowType,
      zeroPadding,
      gain,
      range,
      algorithm,
      targetWidth: maxFrames,
    });

    setStatus("Rendering...");

    renderSpectrogram({
      canvas,
      spectrogram: currentSpectrogram,
      ...getRenderOptions(),
    });

    updateInfo(currentSpectrogram);
    setStatus("Done!");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus("Error processing audio");
    showError(message, "Processing Error");
    console.error(error);
  }
}

async function loadAudioFile(file: File) {
  setStatus("Loading audio file...");

  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    currentSamples = audioBuffer.getChannelData(0);
    currentSampleRate = audioBuffer.sampleRate;
    originalSamples = null;
    zoomStack = [];
    updateFreqSliderRanges(currentSampleRate);
    updateZoomIndicator();

    setStatus(`Loaded: ${file.name} (${audioBuffer.duration.toFixed(2)}s)`);

    await processAndRender();

    if (currentSpectrogram) {
      const { minFreq, maxFreq } = analyzeFrequencyRange(currentSpectrogram);
      setFreqRange(minFreq, maxFreq);
      renderSpectrogram({
        canvas,
        spectrogram: currentSpectrogram,
        ...getRenderOptions(),
        minFreq,
        maxFreq,
      });
    }

    // Clear undo stack on new file load and push initial state
    undoStack.length = 0;
    pushUndoState();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus("Error loading audio");
    showError(message, "Audio Load Error");
    console.error(error);
  }
}

function generateTestTone() {
  setStatus("Generating test tone...");

  const duration = 2;
  const sampleRate = 44100;
  const numSamples = duration * sampleRate;

  currentSamples = new Float32Array(numSamples);
  currentSampleRate = sampleRate;
  originalSamples = null;
  zoomStack = [];
  updateFreqSliderRanges(sampleRate);
  updateZoomIndicator();

  const startFreq = 100;
  const endFreq = 8000;

  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const phase = 2 * Math.PI * startFreq * duration / Math.log(endFreq / startFreq) *
      (Math.pow(endFreq / startFreq, t / duration) - 1);
    currentSamples[i] = 0.5 * Math.sin(phase);
    currentSamples[i] += 0.25 * Math.sin(2 * phase);
    currentSamples[i] += 0.125 * Math.sin(3 * phase);
  }

  setFreqRange(50, 10000);
  processAndRender();

  // Clear undo stack on new audio and push initial state
  undoStack.length = 0;
  pushUndoState();
}

async function loadDefaultAudio() {
  setStatus("Loading default audio...");
  try {
    const response = await fetch("/WHERE.WAV");
    if (!response.ok) throw new Error("Failed to fetch default audio");
    const arrayBuffer = await response.arrayBuffer();
    const audioContext = new AudioContext();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    currentSamples = audioBuffer.getChannelData(0);
    currentSampleRate = audioBuffer.sampleRate;
    originalSamples = null;
    zoomStack = [];
    updateFreqSliderRanges(currentSampleRate);
    updateZoomIndicator();

    setStatus(`Loaded: WHERE.WAV (${audioBuffer.duration.toFixed(2)}s)`);
    await processAndRender();

    if (currentSpectrogram) {
      const { minFreq, maxFreq } = analyzeFrequencyRange(currentSpectrogram);
      setFreqRange(minFreq, maxFreq);
      renderSpectrogram({
        canvas,
        spectrogram: currentSpectrogram,
        ...getRenderOptions(),
        minFreq,
        maxFreq,
      });
    }

    // Clear undo stack on new file load and push initial state
    undoStack.length = 0;
    pushUndoState();
  } catch (error) {
    setStatus("Load an audio file or generate a test tone to begin");
    showToast("info", "Default audio not available. Load a file to begin.", { title: "No Default Audio" });
    console.error("Could not load default audio:", error);
  }
}

// =============================================================================
// Canvas Resizing
// =============================================================================

const canvasContainer = getElement<HTMLDivElement>("canvasContainer");
const canvasWrapper = getElement<HTMLDivElement>("canvasWrapper");
const sizeIndicator = getElement<HTMLDivElement>("sizeIndicator");
const resetSizeBtn = getElement<HTMLButtonElement>("resetSizeBtn");
const resizeHandles = document.querySelectorAll(".resize-handle");

let isCustomSize = false;
let customWidth = 0;
let customHeight = 0;

function updateSizeIndicator() {
  const rect = canvasWrapper.getBoundingClientRect();
  sizeIndicator.textContent = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
}

function setCustomSize(width: number, height: number) {
  isCustomSize = true;
  customWidth = Math.max(100, width);
  customHeight = Math.max(50, height);
  canvasWrapper.style.width = `${customWidth}px`;
  canvasWrapper.style.height = `${customHeight}px`;
  canvasWrapper.classList.add("custom-size");
  updateSizeIndicator();
}

function resetSize() {
  isCustomSize = false;
  canvasWrapper.classList.remove("custom-size");
  canvasWrapper.style.width = "";
  canvasWrapper.style.height = "";
  updateSizeIndicator();
}

resetSizeBtn.addEventListener("click", () => {
  resetSize();
  pushUndoState();
});

let resizeType: string | null = null;
let startX = 0;
let startY = 0;
let startWidth = 0;
let startHeight = 0;

resizeHandles.forEach((handle) => {
  if (!(handle instanceof HTMLElement)) return;
  handle.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();
    const target = e.currentTarget;
    if (!(target instanceof HTMLElement)) return;
    resizeType = target.dataset.resize || null;
    if (!resizeType) return;

    const rect = canvasWrapper.getBoundingClientRect();
    startX = e.clientX;
    startY = e.clientY;
    startWidth = rect.width;
    startHeight = rect.height;

    setCustomSize(startWidth, startHeight);

    target.classList.add("active");
    canvasWrapper.classList.add("resizing");

    document.addEventListener("mousemove", onResizeMove);
    document.addEventListener("mouseup", onResizeEnd);
  });
});

function onResizeMove(e: MouseEvent) {
  if (!resizeType) return;

  const dx = e.clientX - startX;
  const dy = e.clientY - startY;

  let newWidth = startWidth;
  let newHeight = startHeight;

  if (resizeType.includes("e")) {
    newWidth = startWidth + dx * 2;
  }
  if (resizeType.includes("s")) {
    newHeight = startHeight + dy * 2;
  }

  const containerRect = canvasContainer.getBoundingClientRect();
  newWidth = Math.min(newWidth, containerRect.width - 24);
  newHeight = Math.min(newHeight, containerRect.height - 24);

  setCustomSize(newWidth, newHeight);
}

function onResizeEnd() {
  resizeType = null;
  canvasWrapper.classList.remove("resizing");
  document.querySelectorAll(".resize-handle.active").forEach((el) => {
    el.classList.remove("active");
  });
  document.removeEventListener("mousemove", onResizeMove);
  document.removeEventListener("mouseup", onResizeEnd);
  pushUndoState();
}

window.addEventListener("resize", updateSizeIndicator);

// ResizeObserver to update size indicator
const resizeObserver = new ResizeObserver(() => {
  updateSizeIndicator();
});
resizeObserver.observe(canvasWrapper);

// =============================================================================
// Region Selection for Zoom
// =============================================================================

const selectionOverlay = getElement<HTMLDivElement>("selectionOverlay");
const resetZoomBtnForSelection = getElement<HTMLButtonElement>("resetZoomBtn");

let isSelecting = false;
let selectionStartX = 0;

canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return; // Left click only
  if (!currentSamples) return;

  const rect = canvas.getBoundingClientRect();
  selectionStartX = e.clientX - rect.left;
  isSelecting = true;

  selectionOverlay.style.left = `${selectionStartX}px`;
  selectionOverlay.style.width = "0px";
  selectionOverlay.style.display = "block";
});

canvas.addEventListener("mousemove", (e) => {
  if (!isSelecting) return;

  const rect = canvas.getBoundingClientRect();
  const currentX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
  const left = Math.min(selectionStartX, currentX);
  const width = Math.abs(currentX - selectionStartX);

  selectionOverlay.style.left = `${left}px`;
  selectionOverlay.style.width = `${width}px`;
});

document.addEventListener("mouseup", (e) => {
  if (!isSelecting) return;
  isSelecting = false;

  const rect = canvas.getBoundingClientRect();
  const endX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));

  selectionOverlay.style.display = "none";

  // Zoom to selected region
  zoomToRegion(selectionStartX, endX);
});

resetZoomBtnForSelection.addEventListener("click", resetZoom);

// =============================================================================
// Keyboard Shortcuts
// =============================================================================

document.addEventListener("keydown", (e) => {
  // Ctrl+Z or Cmd+Z for undo
  if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
    e.preventDefault();
    undo();
  }
});

// =============================================================================
// Initialization
// =============================================================================

buildControls();

// Wire up file input and button
controls["audioFile"].input.addEventListener("change", (e) => {
  const target = e.target;
  if (target instanceof HTMLInputElement && target.files) {
    const file = target.files[0];
    if (file) loadAudioFile(file);
  }
});

const synthButton = controls["generateSynth"].input;
if (synthButton instanceof HTMLButtonElement) {
  synthButton.addEventListener("click", generateTestTone);
}

// Global error handlers
window.addEventListener("error", (event) => {
  showError(event.message, "Unexpected Error");
});

window.addEventListener("unhandledrejection", (event) => {
  const message = event.reason instanceof Error ? event.reason.message : String(event.reason);
  showError(message, "Unhandled Error");
});

updateSizeIndicator();
loadDefaultAudio();
