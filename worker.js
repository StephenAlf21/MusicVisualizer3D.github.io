// worker.js

// Import the Transformers.js library
import { pipeline } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.10.0';

// Singleton class to ensure the model is loaded only once
class MyTranscriptionPipeline {
    static task = 'automatic-speech-recognition';
    static model = 'Xenova/whisper-tiny.en';
    static instance = null;

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            this.instance = await pipeline(this.task, this.model, { progress_callback });
        }
        return this.instance;
    }
}

// Listen for messages from the main thread
self.onmessage = async (event) => {
    try {
        const inputData = event.data.audio;

        // 1. Load the AI model
        // Inform the main thread that the model is loading
        self.postMessage({ status: 'loading_model' });
        const transcriber = await MyTranscriptionPipeline.getInstance((progress) => {
            // Send detailed progress updates to the main thread
            self.postMessage({ status: 'model_progress', progress });
        });

        // 2. Perform the transcription
        // Inform the main thread that transcription is in progress
        self.postMessage({ status: 'transcribing' });
        const result = await transcriber(inputData, {
            return_timestamps: 'word',
            chunk_length_s: 30,
        });

        // 3. Send the final result back to the main thread
        self.postMessage({ status: 'complete', result });

    } catch (err) {
        // Inform the main thread of any errors
        self.postMessage({ status: 'error', message: err.message });
    }
};
