class AudioProcessor extends AudioWorkletProcessor {
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (input.length > 0) {
            const channelData = input[0]; // Assuming mono channel
            // Send audio data to the main thread
            this.port.postMessage({ audioBuffer: channelData.slice() });
        }
        return true; // Keep processor alive
    }
}

registerProcessor("audio-processor", AudioProcessor);
