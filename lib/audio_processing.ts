import decodeAudio from "npm:audio-decode";
import audioBufferToWav from "npm:audiobuffer-to-wav";
import { AudioContext } from "npm:web-audio-api";
import { v4 as uuidv4 } from "npm:uuid";
import { join as pathJoin } from "jsr:@std/path";

/** Clips a segment of audio from an audiobuffer from a given index to an end index */
export function clip(
    audioBuffer: AudioBuffer,
    start: number,
    end: number,
): AudioBuffer {
    const context = new AudioContext();
    const duration = end - start;
    const outputBuffer = context.createBuffer(
        1,
        duration,
        audioBuffer.sampleRate,
    );
    const outputData = outputBuffer.getChannelData(0);
    const inputData = audioBuffer.getChannelData(0);
    for (let i = 0; i < duration; i++) {
        outputData[i] = inputData[start + i];
    }
    return outputBuffer;
}

export async function decodeWebm(webmData: ArrayBuffer): Promise<AudioBuffer> {
    const startedAt = Date.now();
    const tempDir = Deno.makeTempDirSync();
    const tempWebmPath = pathJoin(tempDir, `${uuidv4()}.webm`);
    const tempWavPath = pathJoin(tempDir, `${uuidv4()}.wav`);

    // Write WebM data to a temporary file
    await Deno.writeFile(tempWebmPath, new Uint8Array(webmData));

    const command = new Deno.Command("ffmpeg", {
        args: [
            "-i",
            tempWebmPath,
            "-f",
            "wav",
            "-ar",
            "16000", // Sample rate
            "-ac",
            "1", // Number of channels
            tempWavPath,
        ],
        stderr: "piped",
    });

    const process = command.spawn();
    const { success, stderr } = await process.output();

    if (!success) {
        const errorMessage = new TextDecoder().decode(stderr);
        console.error("FFmpeg Error:", errorMessage);
        throw new Error(`Failed to convert WebM to WAV: ${errorMessage}`);
    }

    // Read WAV data from the temporary file
    const wavData = await Deno.readFile(tempWavPath);

    // Clean up temporary files
    await Deno.remove(tempWebmPath);
    await Deno.remove(tempWavPath);

    const audioBuffer = await decodeAudio(wavData.buffer);
    const endedAt = Date.now();
    console.log(`Decoded WebM in ${endedAt - startedAt}ms.`);
    return audioBuffer;
}

export async function decode(audioData: Uint8Array): Promise<AudioBuffer> {
    const audioBuffer = await decodeAudio(audioData.buffer);
    return audioBuffer;
}

export async function join(
    buffer1: AudioBuffer,
    buffer2: AudioBuffer,
): Promise<AudioBuffer> {
    const context = new AudioContext();
    const outputBuffer = context.createBuffer(
        1,
        buffer1.length + buffer2.length,
        buffer1.sampleRate,
    );
    const outputData = outputBuffer.getChannelData(0);
    const buffer1Data = buffer1.getChannelData(0);
    const buffer2Data = buffer2.getChannelData(0);
    outputData.set(buffer1Data);
    outputData.set(buffer2Data, buffer1.length);
    return outputBuffer;
}

export async function toWav(audioBuffer: AudioBuffer): Promise<Uint8Array> {
    const wavData = audioBufferToWav(audioBuffer);
    return new Uint8Array(wavData);
}