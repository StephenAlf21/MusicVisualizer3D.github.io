// worker.js

import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.10.0';

// Cache one pipeline per (task, model, device) to avoid reloading
const TASK = 'automatic-speech-recognition';
const pipelineCache = new Map();

/**
 * Gets a transcription pipeline from the cache or creates a new one.
 * @param {string} model The model identifier.
 * @param {string} device The device to run on ('webgpu', 'wasm', 'auto').
 * @param {function} progress_callback A function to call with loading progress.
 * @returns {Promise<import('@xenova/transformers').Pipeline>} The transcription pipeline.
 */
async function getTranscriber(model, device, progress_callback) {
  const key = `${TASK}|${model}|${device || 'auto'}`;
  if (!pipelineCache.has(key)) {
    const opts = { progress_callback };
    // Only set device if explicitly requested (lets library auto-pick otherwise)
    if (device && device !== 'auto') {
        opts.device = device; // 'webgpu' or 'wasm'
    }
    // Create and cache the new pipeline
    pipelineCache.set(key, await pipeline(TASK, model, opts));
  }
  return pipelineCache.get(key);
}

// Listen for messages from the main thread
self.onmessage = async (event) => {
  try {
    const { audio, model, device } = event.data;

    // Reconstruct Float32Array from the transferred ArrayBuffer
    const inputData = new Float32Array(audio);

    // Tell UI what we’re loading
    self.postMessage({ status: 'loading_model', model, device: device || 'auto' });

    // Load/get pipeline for the selected model and backend
    const transcriber = await getTranscriber(model, device, (progress) => {
      self.postMessage({
        status: 'model_progress',
        progress: {
          file: progress.file,
          progress: progress.progress,
          status: progress.status,
          loaded: progress.loaded,
          total: progress.total,
        }
      });
    });

    // Notify UI that transcription is starting
    self.postMessage({ status: 'transcribing' });

    // Define a callback function to report transcription progress
    const progress_callback = (p) => {
      self.postMessage({
        status: 'transcribe_progress',
        progress: {
          processed_chunks: p.processed_chunks,
          total_chunks: p.total_chunks,
        }
      });
    };

    // Perform the transcription
    const result = await transcriber(inputData, {
      return_timestamps: 'word',
      chunk_length_s: 30,
      callback_function: progress_callback,
    });

    // Sanitize and send the final result
    const sanitizedChunks = result.chunks.map(ch => ({ text: ch.text, timestamp: ch.timestamp }));
    self.postMessage({ status: 'complete', text: result.text, chunks: sanitizedChunks });

  } catch (err) {
    // Report any errors back to the main thread
    self.postMessage({ status: 'error', message: err.message });
  }
};
