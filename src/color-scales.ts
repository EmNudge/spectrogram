import type { ColorScale, ColorScaleFunction, RGB } from "./types";

/**
 * Color scales for spectrogram rendering
 */
export const COLOR_SCALES: Record<ColorScale, ColorScaleFunction> = {
  viridis: (t: number): RGB => {
    const r = Math.max(
      0,
      Math.min(255, Math.floor(255 * (0.267 + 0.329 * t + 2.66 * t * t - 2.35 * t * t * t))),
    );
    const g = Math.max(
      0,
      Math.min(255, Math.floor(255 * (0.004 + 1.42 * t - 1.54 * t * t + 0.69 * t * t * t))),
    );
    const b = Math.max(
      0,
      Math.min(255, Math.floor(255 * (0.329 + 1.42 * t - 2.49 * t * t + 1.33 * t * t * t))),
    );
    return [r, g, b];
  },

  magma: (t: number): RGB => {
    // Match Audacity's default spectrogram colormap:
    // Black -> Dark Blue -> Magenta -> Orange -> White
    // Based on documented dB bands with gain=20, range=80:
    // -100 to -80 dB: Black to Blue (t: 0.0 - 0.25)
    // -80 to -60 dB: Blue to Magenta (t: 0.25 - 0.5)
    // -60 to -40 dB: Magenta to Orange (t: 0.5 - 0.75)
    // -40 to -20 dB: Orange to White (t: 0.75 - 1.0)
    if (t < 0.25) {
      // Black to dark blue
      const s = t / 0.25;
      return [
        Math.floor(3 * s),
        Math.floor(3 * s),
        Math.floor(80 * s),
      ];
    } else if (t < 0.5) {
      // Dark blue to magenta
      const s = (t - 0.25) / 0.25;
      return [
        Math.floor(3 + 177 * s),
        Math.floor(3 - 3 * s),
        Math.floor(80 + 100 * s),
      ];
    } else if (t < 0.75) {
      // Magenta to orange
      const s = (t - 0.5) / 0.25;
      return [
        Math.floor(180 + 75 * s),
        Math.floor(0 + 140 * s),
        Math.floor(180 - 180 * s),
      ];
    } else {
      // Orange to white
      const s = (t - 0.75) / 0.25;
      return [
        255,
        Math.floor(140 + 115 * s),
        Math.floor(0 + 255 * s),
      ];
    }
  },

  grayscale: (t: number): RGB => {
    const v = Math.floor(255 * t);
    return [v, v, v];
  },

  // Hot: Black -> Red -> Yellow -> White
  hot: (t: number): RGB => {
    if (t < 0.33) {
      return [Math.floor(255 * (t / 0.33)), 0, 0];
    } else if (t < 0.67) {
      return [255, Math.floor(255 * ((t - 0.33) / 0.34)), 0];
    } else {
      return [255, 255, Math.floor(255 * ((t - 0.67) / 0.33))];
    }
  },

  // Inferno: Black -> Purple -> Red -> Orange -> Yellow
  inferno: (t: number): RGB => {
    if (t < 0.15) {
      const s = t / 0.15;
      return [Math.floor(10 + 50 * s), 0, Math.floor(20 + 60 * s)];
    } else if (t < 0.4) {
      const s = (t - 0.15) / 0.25;
      return [Math.floor(60 + 120 * s), Math.floor(20 * s), Math.floor(80 + 40 * s)];
    } else if (t < 0.65) {
      const s = (t - 0.4) / 0.25;
      return [Math.floor(180 + 60 * s), Math.floor(20 + 60 * s), Math.floor(120 - 100 * s)];
    } else if (t < 0.85) {
      const s = (t - 0.65) / 0.2;
      return [255, Math.floor(80 + 120 * s), Math.floor(20 - 20 * s)];
    } else {
      const s = (t - 0.85) / 0.15;
      return [255, Math.floor(200 + 55 * s), Math.floor(100 * s)];
    }
  },
};
