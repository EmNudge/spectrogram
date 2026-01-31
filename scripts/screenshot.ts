#!/usr/bin/env npx tsx
/**
 * Generate a spectrogram PNG from a WAV file
 *
 * Usage: npx tsx scripts/screenshot.ts <input.wav> [output.png]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { deflateSync } from "node:zlib";
import { generateSpectrogram, renderToImageData } from "../src/index.js";
import type { FFTContext, ColorScale, FrequencyScale } from "../src/types.js";

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

// Cooley-Tukey FFT implementation
function createFFTContext(size: number): FFTContext {
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

// Simple WAV parser (supports PCM 8/16/24/32-bit and 32-bit float)
function readWav(filePath: string): { samples: Float32Array; sampleRate: number } {
  const buffer = readFileSync(filePath);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // Check RIFF header
  const riff = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (riff !== "RIFF") throw new Error("Not a valid WAV file (missing RIFF header)");

  const wave = String.fromCharCode(view.getUint8(8), view.getUint8(9), view.getUint8(10), view.getUint8(11));
  if (wave !== "WAVE") throw new Error("Not a valid WAV file (missing WAVE format)");

  // Find fmt chunk
  let offset = 12;
  let audioFormat = 0;
  let numChannels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;

  while (offset < buffer.length - 8) {
    const chunkId = String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3)
    );
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === "fmt ") {
      audioFormat = view.getUint16(offset + 8, true);
      numChannels = view.getUint16(offset + 10, true);
      sampleRate = view.getUint32(offset + 12, true);
      bitsPerSample = view.getUint16(offset + 22, true);
    } else if (chunkId === "data") {
      const dataOffset = offset + 8;
      const bytesPerSample = bitsPerSample / 8;
      const numSamples = chunkSize / bytesPerSample / numChannels;
      const samples = new Float32Array(numSamples);

      for (let i = 0; i < numSamples; i++) {
        // Read first channel only (mono or left channel)
        const sampleOffset = dataOffset + i * numChannels * bytesPerSample;

        if (audioFormat === 3) {
          // IEEE float
          samples[i] = view.getFloat32(sampleOffset, true);
        } else if (audioFormat === 1) {
          // PCM
          if (bitsPerSample === 8) {
            samples[i] = (view.getUint8(sampleOffset) - 128) / 128;
          } else if (bitsPerSample === 16) {
            samples[i] = view.getInt16(sampleOffset, true) / 32768;
          } else if (bitsPerSample === 24) {
            const b0 = view.getUint8(sampleOffset);
            const b1 = view.getUint8(sampleOffset + 1);
            const b2 = view.getUint8(sampleOffset + 2);
            let val = (b2 << 16) | (b1 << 8) | b0;
            if (val & 0x800000) val |= 0xff000000; // Sign extend
            samples[i] = val / 8388608;
          } else if (bitsPerSample === 32) {
            samples[i] = view.getInt32(sampleOffset, true) / 2147483648;
          }
        }
      }

      return { samples, sampleRate };
    }

    offset += 8 + chunkSize;
    if (chunkSize % 2 === 1) offset++; // Pad byte
  }

  throw new Error("No data chunk found in WAV file");
}

// Convert ImageData to PNG using pure JS (minimal implementation)
function imageDataToPng(imageData: ImageData): Buffer {
  const { width, height, data } = imageData;

  // PNG signature
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  // Create IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type (RGBA)
  ihdr.writeUInt8(0, 10); // compression
  ihdr.writeUInt8(0, 11); // filter
  ihdr.writeUInt8(0, 12); // interlace

  // Create raw image data with filter bytes
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // No filter
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = y * (1 + width * 4) + 1 + x * 4;
      rawData[dstIdx] = data[srcIdx]; // R
      rawData[dstIdx + 1] = data[srcIdx + 1]; // G
      rawData[dstIdx + 2] = data[srcIdx + 2]; // B
      rawData[dstIdx + 3] = data[srcIdx + 3]; // A
    }
  }

  // Compress using zlib
  const compressed = deflateSync(rawData, { level: 6 });

  // Helper to create PNG chunk
  function createChunk(type: string, data: Buffer): Buffer {
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length, 0);
    chunk.write(type, 4, 4, "ascii");
    data.copy(chunk, 8);
    const crc = crc32(Buffer.concat([Buffer.from(type, "ascii"), data]));
    chunk.writeUInt32BE(crc, 8 + data.length);
    return chunk;
  }

  // CRC32 calculation
  function crc32(buf: Buffer): number {
    let crc = 0xffffffff;
    const table = getCrcTable();
    for (let i = 0; i < buf.length; i++) {
      crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  let crcTable: Uint32Array | null = null;
  function getCrcTable(): Uint32Array {
    if (crcTable) return crcTable;
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c;
    }
    return crcTable;
  }

  const ihdrChunk = createChunk("IHDR", ihdr);
  const idatChunk = createChunk("IDAT", compressed);
  const iendChunk = createChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

// Main
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage: npx tsx scripts/screenshot.ts <input.wav> [output.png]");
    console.log("");
    console.log("Options:");
    console.log("  --fft-size <n>     FFT size (default: 512)");
    console.log("  --color <scale>    Color scale: magma, viridis, inferno, hot, grayscale (default: magma)");
    console.log("  --freq-scale <s>   Frequency scale: mel, log, linear, bark, erb (default: log)");
    console.log("  --gain <db>        Gain in dB (default: 25)");
    console.log("  --range <db>       Dynamic range in dB (default: 80)");
    console.log("  --min-freq <hz>    Minimum frequency (default: 20)");
    console.log("  --max-freq <hz>    Maximum frequency (default: nyquist/2)");
    console.log("  --overlap <0-1>    Overlap factor, e.g. 0.85 for 85% (default: 0.85)");
    console.log("  --width <px>       Output width (default: 1000)");
    console.log("  --height <px>      Output height (default: 500)");
    console.log("  --no-upscale       Disable upscaling, output at native resolution");
    process.exit(1);
  }

  // Parse arguments - defaults tuned to match Audacity's spectrogram appearance
  let inputPath = "";
  let outputPath = "";
  let fftSize = 512;
  let colorScale: ColorScale = "magma";
  let freqScale: FrequencyScale = "log";
  let gain = 25;
  let range = 80;
  let minFreqArg: number | undefined = 20;
  let maxFreqArg: number | undefined;
  let overlap = 0.85;
  let outputWidth: number | undefined = 1000;  // Similar to Audacity's ~1063
  let outputHeight: number | undefined = 500;  // Similar to Audacity's ~547

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--fft-size") {
      fftSize = parseInt(args[++i], 10);
    } else if (arg === "--color") {
      colorScale = args[++i] as ColorScale;
    } else if (arg === "--freq-scale") {
      freqScale = args[++i] as FrequencyScale;
    } else if (arg === "--gain") {
      gain = parseFloat(args[++i]);
    } else if (arg === "--range") {
      range = parseFloat(args[++i]);
    } else if (arg === "--min-freq") {
      minFreqArg = parseFloat(args[++i]);
    } else if (arg === "--max-freq") {
      maxFreqArg = parseFloat(args[++i]);
    } else if (arg === "--overlap") {
      overlap = parseFloat(args[++i]);
    } else if (arg === "--width") {
      const w = parseInt(args[++i], 10);
      outputWidth = w > 0 ? w : undefined;
    } else if (arg === "--height") {
      const h = parseInt(args[++i], 10);
      outputHeight = h > 0 ? h : undefined;
    } else if (arg === "--no-upscale") {
      outputWidth = undefined;
      outputHeight = undefined;
    } else if (!inputPath) {
      inputPath = arg;
    } else if (!outputPath) {
      outputPath = arg;
    }
  }

  if (!inputPath) {
    console.error("Error: No input file specified");
    process.exit(1);
  }

  // Default output path
  if (!outputPath) {
    outputPath = basename(inputPath).replace(/\.\w+$/, "") + ".png";
  }

  const resolvedInput = resolve(inputPath);
  const resolvedOutput = resolve(outputPath);

  console.log(`Reading: ${resolvedInput}`);

  // Read WAV file
  const { samples, sampleRate } = readWav(resolvedInput);
  console.log(`  Sample rate: ${sampleRate} Hz`);
  console.log(`  Duration: ${(samples.length / sampleRate).toFixed(2)}s`);
  console.log(`  Samples: ${samples.length}`);

  // Create FFT context
  const fftContext = createFFTContext(fftSize);

  // Calculate hop size from overlap
  const hopSize = Math.floor(fftSize * (1 - overlap));

  console.log(`Generating spectrogram (FFT size: ${fftSize}, hop: ${hopSize}, overlap: ${(overlap * 100).toFixed(1)}%)...`);

  // Generate spectrogram
  const spectrogram = generateSpectrogram({
    samples,
    sampleRate,
    fftContext,
    windowType: "hann",
    algorithm: "standard",
    gain,
    range,
    hopSize,
  });

  console.log(`  Frames: ${spectrogram.numFrames}`);
  console.log(`  Bins: ${spectrogram.numBins}`);
  console.log(`  FFT time: ${spectrogram.timing.fftTime.toFixed(1)}ms`);

  // Get frequency range (use provided values or sensible defaults)
  const nyquist = sampleRate / 2;
  const minFreq = minFreqArg ?? 20;
  const maxFreq = maxFreqArg ?? Math.min(nyquist, Math.round(nyquist / 2)); // Default to half nyquist

  console.log(`Rendering (${colorScale}, ${freqScale} scale)...`);

  // Render to ImageData
  const imageData = renderToImageData({
    spectrogram,
    colorScale,
    freqScale,
    minFreq,
    maxFreq,
    interpolation: "cubic",
    outputWidth,
    outputHeight,
  }) as ImageData;

  console.log(`  Image size: ${imageData.width}x${imageData.height}`);

  // Save as PNG
  const pngBuffer = imageDataToPng(imageData);
  writeFileSync(resolvedOutput, pngBuffer);

  console.log(`Saved: ${resolvedOutput}`);
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
