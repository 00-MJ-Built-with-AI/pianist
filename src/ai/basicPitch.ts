import type * as TF from '@tensorflow/tfjs';

/*
 * Spotify's Basic Pitch model (Apache-2.0), loaded once and shared by the live microphone detector
 * and the audio-file transcriber. TensorFlow.js is only downloaded when one of them is first used.
 */

export const SAMPLE_RATE = 22050;
export const WINDOW_SAMPLES = SAMPLE_RATE * 2 - 256; // 43 844 samples per model window
export const FFT_HOP = 256;

export interface LoadedModel {
  tf: typeof TF;
  model: TF.GraphModel;
}

let loading: Promise<LoadedModel> | null = null;

export function loadBasicPitch(): Promise<LoadedModel> {
  loading ??= (async () => {
    const tf = await import('@tensorflow/tfjs');
    try {
      await tf.setBackend('webgl');
    } catch {
      await tf.setBackend('cpu');
    }
    await tf.ready();
    const model = await tf.loadGraphModel(`${import.meta.env.BASE_URL}models/basic-pitch/model.json`);
    // Warm-up so the first real window isn't slow.
    const warm = tf.zeros([1, WINDOW_SAMPLES, 1]);
    const out = model.execute(warm, ['Identity_1', 'Identity_2']) as TF.Tensor[];
    await Promise.all(out.map((t) => t.data()));
    out.forEach((t) => t.dispose());
    warm.dispose();
    return { tf, model };
  })();
  loading.catch(() => {
    loading = null; // allow a retry after a failed download
  });
  return loading;
}
