import { AudioProcessingService } from "./AudioProcessingService.ts";
import { split } from "npm:sentence-splitter";

/**
 * Class representing a continuous transcription service that processes and concatenates audio segments.
 */
class ContinuousTranscription {
    /**
     * Array to store the audio segments without headers.
     */
    private audioSegments: Uint8Array[] = [];

    /**
     * The header for the WAV audio format. All segments must have the same header.
     */
    private audioHeader: Uint8Array | null = null;

    /**
     * The current proposed transcription log.
     */
    private proposedTranscription: string = "";

    /**
     * Creates an instance of ContinuousTranscription.
     * @param onFinalTranscription - Callback invoked when the final transcription is available.
     * @param onPredictionUpdate - Callback invoked with a prediction update.
     */
    constructor(
        private onFinalTranscription: (
            transcribedText: string,
        ) => Promise<void>,
        private onPredictionUpdate: (possibleText: string) => void,
    ) {}

    /**
     * Pushes a new audio segment for processing.
     * Converts the WebM segment to WAV, strips the header, and stores the segment.
     * Throws an error if the WAV headers are inconsistent.
     * @param segment - The audio segment in WebM format.
     */
    async push(segment: Uint8Array): Promise<void> {
        try {
            const wavData = await AudioProcessingService.convertWebmToWav(
                segment.buffer,
            );
            const header = wavData.slice(0, 44);
            const strippedAudio = AudioProcessingService.getWavHeader(
                wavData,
            );

            if (this.audioHeader === null) {
                this.audioHeader = header;
            } else if (!this.headersAreEqual(this.audioHeader, header)) {
                throw new Error("Audio headers are inconsistent.");
            }

            this.audioSegments.push(strippedAudio);
            await this.updateTranscription();
        } catch (error) {
            console.error("Error processing segment:", error);
        }
    }

    /**
     * Updates the transcription using the current concatenated audio.
     */
    private async updateTranscription(): Promise<void> {
        try {
            const concatenatedAudio = this.concatenatedAudio;
            const { transcription } = await AudioProcessingService
                .getWhisperTranscription(concatenatedAudio);
            this.proposedTranscription = transcription;
            this.onPredictionUpdate(transcription);

            const sentences = split(transcription).filter((node) =>
                node.type === "Sentence"
            );
            if (sentences.length >= 3) {
                const stableTranscription = sentences.slice(0, 2).map((s) =>
                    s.raw
                ).join(" ");
                await this.onFinalTranscription(stableTranscription);
                this.trimBuffer(stableTranscription.length);
            }
        } catch (error) {
            console.error("Error updating transcription:", error);
        }
    }

    /**
     * Trims the audio buffer and the transcription log to keep them in sync.
     * @param length - The number of characters to trim from the start of the transcription.
     */
    private trimBuffer(length: number): void {
        // Trim the transcription log.
        this.proposedTranscription = this.proposedTranscription.slice(length);

        // Trim the audio buffer.
        const totalLength = this.audioSegments.reduce(
            (acc, segment) => acc + segment.length,
            0,
        );
        let bytesToTrim = Math.floor(
            (length / this.proposedTranscription.length) * totalLength,
        );

        while (bytesToTrim > 0 && this.audioSegments.length > 0) {
            const segment = this.audioSegments[0];
            if (segment.length <= bytesToTrim) {
                bytesToTrim -= segment.length;
                this.audioSegments.shift();
            } else {
                this.audioSegments[0] = segment.slice(bytesToTrim);
                bytesToTrim = 0;
            }
        }
    }

    /**
     * Finalizes the transcription process, ensuring any remaining buffer is flushed.
     */
    async finalize(): Promise<void> {
        if (this.proposedTranscription.length > 0) {
            await this.onFinalTranscription(this.proposedTranscription);
            this.proposedTranscription = "";
            this.audioSegments = [];
        }
    }

    /**
     * Strips the WAV header from an audio segment.
     * @param audioSegment - The audio segment in WAV format.
     * @returns The audio segment without the header.
     */
    private stripAudioHeader(audioSegment: Uint8Array): Uint8Array {
        return AudioProcessingService.getWavHeader(audioSegment);
    }

    /**
     * Compares two WAV headers for equality.
     * @param header1 - The first WAV header.
     * @param header2 - The second WAV header.
     * @returns True if the headers are equal, otherwise false.
     */
    private headersAreEqual(header1: Uint8Array, header2: Uint8Array): boolean {
        if (header1.length !== header2.length) return false;
        for (let i = 0; i < header1.length; i++) {
            if (header1[i] !== header2[i]) return false;
        }
        return true;
    }

    /**
     * Gets the concatenated audio segments with the appropriate WAV header.
     * @returns A Uint8Array representing the complete audio.
     * @throws Error if no audio header is available.
     */
    get concatenatedAudio(): Uint8Array {
        if (this.audioHeader === null) {
            throw new Error(
                "No audio header found. Cannot generate concatenated audio.",
            );
        }

        // Concatenate all audio segments and add the audio header.
        const audioData = this.audioSegments.reduce((acc, segment) => {
            const combined = new Uint8Array(acc.length + segment.length);
            combined.set(acc);
            combined.set(segment, acc.length);
            return combined;
        }, new Uint8Array());

        const completeAudio = new Uint8Array(
            this.audioHeader.length + audioData.length,
        );
        completeAudio.set(this.audioHeader);
        completeAudio.set(audioData, this.audioHeader.length);
        return completeAudio;
    }
}

export default ContinuousTranscription;
