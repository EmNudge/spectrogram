import type { FFTContext } from "@emnudge/spectrogram";
import { createRFFTf32 } from "@emnudge/wat-fft/browser";
import wasmUrl from "@emnudge/wat-fft/wasm/rfft-f32.wasm?url";

/**
 * Create an FFT context from the wat-fft real f32 WASM module
 */
export async function createWatFFTContext(size: number): Promise<FFTContext> {
  const fft = await createRFFTf32(size, wasmUrl);

  return {
    size,
    isReal: true,
    getInputBuffer: () => fft.getInputBuffer(),
    getOutputBuffer: () => fft.getOutputBuffer(),
    run: () => fft.forward(),
  };
}
