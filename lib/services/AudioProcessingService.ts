import { v4 as uuidv4 } from "npm:uuid";

let counter = Date.now();

export class AudioProcessingService {
    static async getWhisperTranscription(
        wavData: Uint8Array,
        initialPrompt: string = "",
    ): Promise<
        {
            transcription: string;
            segments: { text: string; start: number; end: number }[];
        }
    > {
        if (!(wavData instanceof Uint8Array) || wavData.length < 44) {
            throw new Error("Invalid WAV data provided for transcription.");
        }

        const whisperUrl = new URL(
            (Deno.env.get("WHISPER_HOST") ?? "http://localhost:9000") + "/asr",
        );
        // whisperUrl.searchParams.append("language", "en");
        whisperUrl.searchParams.append("initial_prompt", initialPrompt);
        // whisperUrl.searchParams.append("output", "json");
        const wavFile = new File([wavData], "audio.wav");

        const body = new FormData();
        body.append("audio_file", wavFile);

        const whisperResponse = await fetch(whisperUrl.toString(), {
            method: "POST",
            body: body,
        });

        if (!whisperResponse.ok) {
            const errorText = await whisperResponse.text();
            throw new Error(
                `Error transcribing audio: ${whisperResponse.statusText} - ${errorText}`,
            );
        }

        const transcriptionResult = {
            text: await whisperResponse.text(),
            segments: [],
        };
        return {
            transcription: transcriptionResult.text.trim(),
            segments: transcriptionResult.segments.map((
                segment: { text: string; start: string; end: string },
            ) => ({
                text: segment.text,
                start: parseFloat(segment.start),
                end: parseFloat(segment.end),
            })),
        };
    }

    static async convertWebmToWav(webmData: ArrayBuffer): Promise<Uint8Array> {
        const command = new Deno.Command("ffmpeg", {
            args: [
                "-i",
                "pipe:0",
                "-f",
                "wav",
                "-ar",
                "16000", // Sample rate
                "-ac",
                "1", // Number of channels
                "pipe:1",
            ],
            stdin: "piped",
            stdout: "piped",
            stderr: "piped",
        });

        const process = command.spawn();
        const writer = process.stdin.getWriter();
        const data = new Uint8Array(webmData);
        await writer.write(data);
        await writer.close();

        const { success, stdout, stderr } = await process.output();

        if (!success) {
            const errorMessage = new TextDecoder().decode(stderr);
            console.error("FFmpeg Error:", errorMessage);
            throw new Error(`Failed to convert WebM to WAV: ${errorMessage}`);
        }

        return stdout;
    }

    static async combineWavData(
        wavData: Uint8Array,
        nextWavData: Uint8Array,
    ): Promise<Uint8Array> {
        // Create temporary files for both WAV inputs
        const tempFile1 = `/tmp/${uuidv4()}.wav`;
        const tempFile2 = `/tmp/${uuidv4()}.wav`;
        const outputFile = `/tmp/${uuidv4()}.wav`;

        try {
            // Write wavData and nextWavData to the temp files
            await Deno.writeFile(tempFile1, wavData);
            await Deno.writeFile(tempFile2, nextWavData);

            // Run SoX command to concatenate the WAV files
            const command = new Deno.Command("sox", {
                args: [
                    tempFile1, // First input file
                    tempFile2, // Second input file
                    outputFile, // Output file
                ],
                stdout: "piped",
                stderr: "piped",
            });

            const process = command.spawn();

            const { success, stderr } = await process.output();

            if (!success) {
                const errorMessage = new TextDecoder().decode(stderr);
                console.error("SoX Error:", errorMessage);
                throw new Error(`Failed to combine WAV data: ${errorMessage}`);
            }

            // Read the combined output WAV file
            const combinedWavData = await Deno.readFile(outputFile);

            // Return the combined WAV data as Uint8Array
            return combinedWavData;
        } finally {
            // Clean up temporary files
            await Deno.remove(tempFile1).catch(() => {});
            await Deno.remove(tempFile2).catch(() => {});
            await Deno.remove(outputFile).catch(() => {});
        }
    }

    /**
     * Updates the WAV header to reflect the new total size.
     */
    static updateWavHeader(
        originalHeader: Uint8Array,
        totalPcmSize: number,
    ): Uint8Array {
        const newHeader = originalHeader.slice(0, 44);
        const totalSize = 36 + totalPcmSize; // Correct calculation

        // Update the ChunkSize field (bytes 4-7)
        newHeader[4] = totalSize & 0xff;
        newHeader[5] = (totalSize >> 8) & 0xff;
        newHeader[6] = (totalSize >> 16) & 0xff;
        newHeader[7] = (totalSize >> 24) & 0xff;

        // Update the Subchunk2Size field (bytes 40-43)
        const subchunk2Size = totalPcmSize; // Correct calculation
        newHeader[40] = subchunk2Size & 0xff;
        newHeader[41] = (subchunk2Size >> 8) & 0xff;
        newHeader[42] = (subchunk2Size >> 16) & 0xff;
        newHeader[43] = (subchunk2Size >> 24) & 0xff;

        return newHeader;
    }

    static getWavHeader(wavData: Uint8Array): Uint8Array {
        return wavData.slice(0, 44);
    }

    /**
     * Extracts PCM data from a WAV file.
     */
    static extractPcm(wavData: Uint8Array): Uint8Array {
        if (wavData.length < 44) {
            throw new Error("WAV data is too short to contain a valid header.");
        }
        return wavData.slice(44);
    }
}
