#!/usr/bin/env npx tsx
/**
 * Image Analysis System
 *
 * Measures image qualities like likeness, color characteristics, and pixelatedness.
 * Useful for comparing spectrograms against reference images.
 *
 * Usage:
 *   npx tsx scripts/image-analysis.ts <image1.png> [image2.png]
 *
 * If two images provided: compares them and outputs similarity metrics
 * If one image provided: outputs analysis of that image
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";

// ============================================================================
// PNG Decoder
// ============================================================================

interface ImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray; // RGBA pixels
}

function decodePng(buffer: Buffer): ImageData {
  // Verify PNG signature
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (buffer[i] !== signature[i]) {
      throw new Error("Not a valid PNG file");
    }
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Buffer[] = [];

  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idatChunks.push(data);
    } else if (type === "IEND") {
      break;
    }

    offset += 12 + length;
  }

  // Decompress image data
  const compressed = Buffer.concat(idatChunks);
  const decompressed = inflateSync(compressed);

  // Determine bytes per pixel based on color type
  let bytesPerPixel: number;
  if (colorType === 6) bytesPerPixel = 4; // RGBA
  else if (colorType === 2) bytesPerPixel = 3; // RGB
  else if (colorType === 4) bytesPerPixel = 2; // Grayscale + Alpha
  else if (colorType === 0) bytesPerPixel = 1; // Grayscale
  else throw new Error(`Unsupported color type: ${colorType}`);

  // Unfilter and convert to RGBA
  const pixels = new Uint8ClampedArray(width * height * 4);
  const scanlineLength = width * bytesPerPixel;
  const prevRow = new Uint8Array(scanlineLength);

  for (let y = 0; y < height; y++) {
    const filterType = decompressed[y * (scanlineLength + 1)];
    const rowStart = y * (scanlineLength + 1) + 1;
    const row = new Uint8Array(scanlineLength);

    // Copy raw data
    for (let i = 0; i < scanlineLength; i++) {
      row[i] = decompressed[rowStart + i];
    }

    // Apply filter
    for (let i = 0; i < scanlineLength; i++) {
      const a = i >= bytesPerPixel ? row[i - bytesPerPixel] : 0;
      const b = prevRow[i];
      const c = i >= bytesPerPixel ? prevRow[i - bytesPerPixel] : 0;

      switch (filterType) {
        case 0: break; // None
        case 1: row[i] = (row[i] + a) & 0xff; break; // Sub
        case 2: row[i] = (row[i] + b) & 0xff; break; // Up
        case 3: row[i] = (row[i] + Math.floor((a + b) / 2)) & 0xff; break; // Average
        case 4: row[i] = (row[i] + paethPredictor(a, b, c)) & 0xff; break; // Paeth
      }
    }

    // Convert to RGBA
    for (let x = 0; x < width; x++) {
      const srcIdx = x * bytesPerPixel;
      const dstIdx = (y * width + x) * 4;

      if (colorType === 6) { // RGBA
        pixels[dstIdx] = row[srcIdx];
        pixels[dstIdx + 1] = row[srcIdx + 1];
        pixels[dstIdx + 2] = row[srcIdx + 2];
        pixels[dstIdx + 3] = row[srcIdx + 3];
      } else if (colorType === 2) { // RGB
        pixels[dstIdx] = row[srcIdx];
        pixels[dstIdx + 1] = row[srcIdx + 1];
        pixels[dstIdx + 2] = row[srcIdx + 2];
        pixels[dstIdx + 3] = 255;
      } else if (colorType === 4) { // Grayscale + Alpha
        pixels[dstIdx] = row[srcIdx];
        pixels[dstIdx + 1] = row[srcIdx];
        pixels[dstIdx + 2] = row[srcIdx];
        pixels[dstIdx + 3] = row[srcIdx + 1];
      } else if (colorType === 0) { // Grayscale
        pixels[dstIdx] = row[srcIdx];
        pixels[dstIdx + 1] = row[srcIdx];
        pixels[dstIdx + 2] = row[srcIdx];
        pixels[dstIdx + 3] = 255;
      }
    }

    prevRow.set(row);
  }

  return { width, height, data: pixels };
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

// ============================================================================
// Color Analysis
// ============================================================================

interface ColorAnalysis {
  /** Average RGB values */
  averageColor: { r: number; g: number; b: number };
  /** Average HSL values */
  averageHsl: { h: number; s: number; l: number };
  /** Color temperature (warm = positive, cool = negative) */
  warmth: number;
  /** Average saturation (0-1) */
  saturation: number;
  /** Average brightness/luminance (0-1) */
  brightness: number;
  /** Dominant hue bucket (0-360 degrees) */
  dominantHue: number;
  /** Color histogram (256 bins per channel) */
  histogram: { r: number[]; g: number[]; b: number[] };
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    default: h = ((r - g) / d + 4) / 6; break;
  }

  return { h: h * 360, s, l };
}

function analyzeColors(image: ImageData): ColorAnalysis {
  const { width, height, data } = image;
  const numPixels = width * height;

  let totalR = 0, totalG = 0, totalB = 0;
  let totalH = 0, totalS = 0, totalL = 0;
  const histogramR = new Array(256).fill(0);
  const histogramG = new Array(256).fill(0);
  const histogramB = new Array(256).fill(0);
  const hueBuckets = new Array(36).fill(0); // 10-degree buckets

  for (let i = 0; i < numPixels; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];

    totalR += r;
    totalG += g;
    totalB += b;

    histogramR[r]++;
    histogramG[g]++;
    histogramB[b]++;

    const hsl = rgbToHsl(r, g, b);
    totalH += hsl.h;
    totalS += hsl.s;
    totalL += hsl.l;

    if (hsl.s > 0.1) { // Only count saturated pixels for hue
      hueBuckets[Math.floor(hsl.h / 10) % 36]++;
    }
  }

  const avgR = totalR / numPixels;
  const avgG = totalG / numPixels;
  const avgB = totalB / numPixels;

  // Warmth: positive = warm (red/orange/yellow), negative = cool (blue/cyan)
  // Based on red-blue difference, weighted by saturation
  const warmth = ((avgR - avgB) / 255) * (totalS / numPixels);

  // Find dominant hue
  let maxHueBucket = 0;
  let dominantHueIdx = 0;
  for (let i = 0; i < 36; i++) {
    if (hueBuckets[i] > maxHueBucket) {
      maxHueBucket = hueBuckets[i];
      dominantHueIdx = i;
    }
  }

  return {
    averageColor: { r: avgR, g: avgG, b: avgB },
    averageHsl: { h: totalH / numPixels, s: totalS / numPixels, l: totalL / numPixels },
    warmth,
    saturation: totalS / numPixels,
    brightness: totalL / numPixels,
    dominantHue: dominantHueIdx * 10 + 5,
    histogram: { r: histogramR, g: histogramG, b: histogramB },
  };
}

// ============================================================================
// Pixelatedness Analysis
// ============================================================================

interface PixelatednessAnalysis {
  /** Laplacian variance (higher = sharper/less pixelated) */
  laplacianVariance: number;
  /** Average gradient magnitude */
  averageGradient: number;
  /** Edge density (proportion of edge pixels) */
  edgeDensity: number;
  /** Block artifact score (higher = more blocky) */
  blockiness: number;
  /** Smoothness score (0-1, higher = smoother) */
  smoothness: number;
}

function analyzePixelatedness(image: ImageData): PixelatednessAnalysis {
  const { width, height, data } = image;

  // Convert to grayscale for edge analysis
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }

  // Laplacian (second derivative) for sharpness
  let laplacianSum = 0;
  let laplacianSumSq = 0;
  let laplacianCount = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const laplacian =
        gray[idx - width] + gray[idx + width] +
        gray[idx - 1] + gray[idx + 1] -
        4 * gray[idx];
      laplacianSum += laplacian;
      laplacianSumSq += laplacian * laplacian;
      laplacianCount++;
    }
  }

  const laplacianMean = laplacianSum / laplacianCount;
  const laplacianVariance = (laplacianSumSq / laplacianCount) - (laplacianMean * laplacianMean);

  // Gradient magnitude (Sobel-like)
  let gradientSum = 0;
  let edgeCount = 0;
  const edgeThreshold = 30;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const gx = gray[idx + 1] - gray[idx - 1];
      const gy = gray[idx + width] - gray[idx - width];
      const magnitude = Math.sqrt(gx * gx + gy * gy);
      gradientSum += magnitude;
      if (magnitude > edgeThreshold) edgeCount++;
    }
  }

  const interiorPixels = (width - 2) * (height - 2);
  const averageGradient = gradientSum / interiorPixels;
  const edgeDensity = edgeCount / interiorPixels;

  // Blockiness detection (look for regular grid patterns)
  // Check for horizontal and vertical edge alignment at common block sizes
  let blockiness = 0;
  const blockSizes = [4, 8, 16];

  for (const blockSize of blockSizes) {
    let alignedEdges = 0;
    let totalChecks = 0;

    // Check vertical lines
    for (let x = blockSize; x < width - 1; x += blockSize) {
      for (let y = 1; y < height - 1; y++) {
        const idx = y * width + x;
        const diff = Math.abs(gray[idx] - gray[idx - 1]);
        if (diff > 10) alignedEdges++;
        totalChecks++;
      }
    }

    // Check horizontal lines
    for (let y = blockSize; y < height - 1; y += blockSize) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const diff = Math.abs(gray[idx] - gray[idx - width]);
        if (diff > 10) alignedEdges++;
        totalChecks++;
      }
    }

    if (totalChecks > 0) {
      blockiness = Math.max(blockiness, alignedEdges / totalChecks);
    }
  }

  // Smoothness: inverse of high-frequency content
  // Higher laplacian variance = less smooth
  const smoothness = 1 / (1 + laplacianVariance / 1000);

  return {
    laplacianVariance,
    averageGradient,
    edgeDensity,
    blockiness,
    smoothness,
  };
}

// ============================================================================
// Image Comparison / Likeness
// ============================================================================

interface LikenessAnalysis {
  /** Mean Squared Error (lower = more similar) */
  mse: number;
  /** Peak Signal-to-Noise Ratio in dB (higher = more similar) */
  psnr: number;
  /** Structural Similarity Index (0-1, higher = more similar) */
  ssim: number;
  /** Histogram intersection (0-1, higher = more similar color distribution) */
  histogramSimilarity: number;
  /** Overall likeness score (0-1) */
  likeness: number;
}

function compareImages(image1: ImageData, image2: ImageData): LikenessAnalysis {
  // Resize images to common size for comparison
  const targetWidth = Math.min(image1.width, image2.width);
  const targetHeight = Math.min(image1.height, image2.height);

  const img1 = resizeImage(image1, targetWidth, targetHeight);
  const img2 = resizeImage(image2, targetWidth, targetHeight);

  const numPixels = targetWidth * targetHeight;

  // MSE and PSNR
  let mseSum = 0;
  for (let i = 0; i < numPixels; i++) {
    const idx = i * 4;
    const dr = img1.data[idx] - img2.data[idx];
    const dg = img1.data[idx + 1] - img2.data[idx + 1];
    const db = img1.data[idx + 2] - img2.data[idx + 2];
    mseSum += (dr * dr + dg * dg + db * db) / 3;
  }
  const mse = mseSum / numPixels;
  const psnr = mse > 0 ? 10 * Math.log10((255 * 255) / mse) : 100;

  // SSIM (simplified version)
  const ssim = calculateSSIM(img1, img2);

  // Histogram similarity
  const hist1 = analyzeColors(img1).histogram;
  const hist2 = analyzeColors(img2).histogram;
  const histSim = (
    histogramIntersection(hist1.r, hist2.r) +
    histogramIntersection(hist1.g, hist2.g) +
    histogramIntersection(hist1.b, hist2.b)
  ) / 3;

  // Overall likeness (weighted combination)
  const normalizedPsnr = Math.min(psnr / 50, 1); // Normalize PSNR to 0-1
  const likeness = 0.4 * ssim + 0.3 * normalizedPsnr + 0.3 * histSim;

  return {
    mse,
    psnr,
    ssim,
    histogramSimilarity: histSim,
    likeness,
  };
}

function resizeImage(image: ImageData, newWidth: number, newHeight: number): ImageData {
  if (image.width === newWidth && image.height === newHeight) {
    return image;
  }

  const newData = new Uint8ClampedArray(newWidth * newHeight * 4);
  const xRatio = image.width / newWidth;
  const yRatio = image.height / newHeight;

  for (let y = 0; y < newHeight; y++) {
    for (let x = 0; x < newWidth; x++) {
      const srcX = Math.floor(x * xRatio);
      const srcY = Math.floor(y * yRatio);
      const srcIdx = (srcY * image.width + srcX) * 4;
      const dstIdx = (y * newWidth + x) * 4;

      newData[dstIdx] = image.data[srcIdx];
      newData[dstIdx + 1] = image.data[srcIdx + 1];
      newData[dstIdx + 2] = image.data[srcIdx + 2];
      newData[dstIdx + 3] = image.data[srcIdx + 3];
    }
  }

  return { width: newWidth, height: newHeight, data: newData };
}

function calculateSSIM(img1: ImageData, img2: ImageData): number {
  const { width, height } = img1;
  const windowSize = 8;
  const C1 = (0.01 * 255) ** 2;
  const C2 = (0.03 * 255) ** 2;

  let ssimSum = 0;
  let windowCount = 0;

  for (let y = 0; y < height - windowSize; y += windowSize) {
    for (let x = 0; x < width - windowSize; x += windowSize) {
      let sum1 = 0, sum2 = 0;
      let sumSq1 = 0, sumSq2 = 0;
      let sumProd = 0;

      for (let wy = 0; wy < windowSize; wy++) {
        for (let wx = 0; wx < windowSize; wx++) {
          const idx = ((y + wy) * width + (x + wx)) * 4;
          // Use luminance
          const v1 = 0.299 * img1.data[idx] + 0.587 * img1.data[idx + 1] + 0.114 * img1.data[idx + 2];
          const v2 = 0.299 * img2.data[idx] + 0.587 * img2.data[idx + 1] + 0.114 * img2.data[idx + 2];

          sum1 += v1;
          sum2 += v2;
          sumSq1 += v1 * v1;
          sumSq2 += v2 * v2;
          sumProd += v1 * v2;
        }
      }

      const n = windowSize * windowSize;
      const mean1 = sum1 / n;
      const mean2 = sum2 / n;
      const var1 = sumSq1 / n - mean1 * mean1;
      const var2 = sumSq2 / n - mean2 * mean2;
      const covar = sumProd / n - mean1 * mean2;

      const ssim = ((2 * mean1 * mean2 + C1) * (2 * covar + C2)) /
                   ((mean1 * mean1 + mean2 * mean2 + C1) * (var1 + var2 + C2));

      ssimSum += ssim;
      windowCount++;
    }
  }

  return windowCount > 0 ? ssimSum / windowCount : 0;
}

function histogramIntersection(hist1: number[], hist2: number[]): number {
  let intersection = 0;
  let total1 = 0;
  let total2 = 0;

  for (let i = 0; i < hist1.length; i++) {
    intersection += Math.min(hist1[i], hist2[i]);
    total1 += hist1[i];
    total2 += hist2[i];
  }

  return intersection / Math.max(total1, total2);
}

// ============================================================================
// Main
// ============================================================================

interface FullAnalysis {
  path: string;
  dimensions: { width: number; height: number };
  color: ColorAnalysis;
  pixelatedness: PixelatednessAnalysis;
}

function analyzeImage(path: string): FullAnalysis {
  const buffer = readFileSync(path);
  const image = decodePng(buffer);

  return {
    path,
    dimensions: { width: image.width, height: image.height },
    color: analyzeColors(image),
    pixelatedness: analyzePixelatedness(image),
  };
}

function formatAnalysis(analysis: FullAnalysis): string {
  const { path, dimensions, color, pixelatedness } = analysis;

  return `
Image: ${path}
Dimensions: ${dimensions.width} x ${dimensions.height}

Color Analysis:
  Average RGB: (${color.averageColor.r.toFixed(1)}, ${color.averageColor.g.toFixed(1)}, ${color.averageColor.b.toFixed(1)})
  Average HSL: (${color.averageHsl.h.toFixed(1)}°, ${(color.averageHsl.s * 100).toFixed(1)}%, ${(color.averageHsl.l * 100).toFixed(1)}%)
  Warmth: ${color.warmth.toFixed(3)} ${color.warmth > 0 ? "(warm)" : "(cool)"}
  Saturation: ${(color.saturation * 100).toFixed(1)}%
  Brightness: ${(color.brightness * 100).toFixed(1)}%
  Dominant Hue: ${color.dominantHue}° ${getHueName(color.dominantHue)}

Pixelatedness Analysis:
  Laplacian Variance: ${pixelatedness.laplacianVariance.toFixed(2)} ${getLaplacianDescription(pixelatedness.laplacianVariance)}
  Average Gradient: ${pixelatedness.averageGradient.toFixed(2)}
  Edge Density: ${(pixelatedness.edgeDensity * 100).toFixed(1)}%
  Blockiness: ${(pixelatedness.blockiness * 100).toFixed(1)}%
  Smoothness: ${(pixelatedness.smoothness * 100).toFixed(1)}%
`.trim();
}

function getHueName(hue: number): string {
  if (hue < 15 || hue >= 345) return "(red)";
  if (hue < 45) return "(orange)";
  if (hue < 75) return "(yellow)";
  if (hue < 165) return "(green)";
  if (hue < 195) return "(cyan)";
  if (hue < 255) return "(blue)";
  if (hue < 285) return "(purple)";
  return "(magenta)";
}

function getLaplacianDescription(variance: number): string {
  if (variance < 100) return "(very smooth/blurry)";
  if (variance < 500) return "(smooth)";
  if (variance < 2000) return "(moderate detail)";
  if (variance < 5000) return "(sharp)";
  return "(very sharp/noisy)";
}

function formatComparison(comparison: LikenessAnalysis): string {
  return `
Comparison Results:
  MSE: ${comparison.mse.toFixed(2)} ${comparison.mse < 100 ? "(very similar)" : comparison.mse < 500 ? "(similar)" : "(different)"}
  PSNR: ${comparison.psnr.toFixed(2)} dB ${comparison.psnr > 30 ? "(high similarity)" : comparison.psnr > 20 ? "(moderate similarity)" : "(low similarity)"}
  SSIM: ${comparison.ssim.toFixed(4)} ${comparison.ssim > 0.9 ? "(excellent)" : comparison.ssim > 0.7 ? "(good)" : "(fair)"}
  Histogram Similarity: ${(comparison.histogramSimilarity * 100).toFixed(1)}%

  Overall Likeness: ${(comparison.likeness * 100).toFixed(1)}%
`.trim();
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.log("Usage: npx tsx scripts/image-analysis.ts <image1.png> [image2.png]");
    console.log("");
    console.log("If two images provided: compares them and outputs similarity metrics");
    console.log("If one image provided: outputs analysis of that image");
    process.exit(1);
  }

  const path1 = resolve(args[0]);
  const analysis1 = analyzeImage(path1);
  console.log(formatAnalysis(analysis1));

  if (args.length >= 2) {
    const path2 = resolve(args[1]);
    const analysis2 = analyzeImage(path2);
    console.log("\n" + "=".repeat(60) + "\n");
    console.log(formatAnalysis(analysis2));

    // Compare the two images
    const buffer1 = readFileSync(path1);
    const buffer2 = readFileSync(path2);
    const image1 = decodePng(buffer1);
    const image2 = decodePng(buffer2);
    const comparison = compareImages(image1, image2);

    console.log("\n" + "=".repeat(60) + "\n");
    console.log(formatComparison(comparison));
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
