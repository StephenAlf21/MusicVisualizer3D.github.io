// worker.js

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

        // 1. Post the model name *before* loading it
        self.postMessage({
            status: 'loading_model',
            model: MyTranscriptionPipeline.model, // <-- FIX: Include the model string
        });

        // 2. Load the AI model, passing a progress callback
        const transcriber = await MyTranscriptionPipeline.getInstance((progress) => {
            // FIX: Sanitize the model loading progress object before sending
            self.postMessage({ 
                status: 'model_progress', 
                progress: {
                    file: progress.file,
                    progress: progress.progress,
                    status: progress.status
                }
            });
        });

        // 3. Perform the transcription
        self.postMessage({ status: 'transcribing' });
        
        const progress_callback = (progress) => {
            // FIX: Sanitize the transcription progress object before sending
            self.postMessage({ 
                status: 'transcribe_progress', 
                progress: {
                    processed_chunks: progress.processed_chunks,
                    total_chunks: progress.total_chunks
                }
            });
        };

        const result = await transcriber(inputData, {
            return_timestamps: 'word',
            chunk_length_s: 30,
            callback_function: progress_callback
        });

        // 4. Sanitize the final result before sending
        const sanitizedChunks = result.chunks.map(chunk => ({
            text: chunk.text,
            timestamp: chunk.timestamp
        }));

        self.postMessage({ 
            status: 'complete', 
            text: result.text,
            chunks: sanitizedChunks
        });

    } catch (err) {
        self.postMessage({ status: 'error', message: err.message });
    }
};
