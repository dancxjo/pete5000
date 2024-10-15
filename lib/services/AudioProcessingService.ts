import { TranscriptionService } from "./TranscriptionService.ts";
import { WebSocketService } from "./WebSocketService.ts";
import type { ClientSession } from "./ClientSessionService.ts";

// AudioProcessingService.ts

export class AudioProcessingService {
    static async processAudio(
        socket: WebSocket,
        session: ClientSession,
        segmentId: number,
        segments: ArrayBuffer[],
        isPartial: boolean,
    ) {
        const { signal } = session.abortController;
        try {
            const wavData = await Promise.all(
                segments.map((segment) => this.convertWebmToWav(segment)),
            );

            if (signal.aborted) {
                console.log("Processing aborted for segment:", segmentId);
                return;
            }

            const head = wavData.shift();
            if (!head) return;
            console.log("Processing segment:", segmentId);
            const tail = wavData.map(this.stripWavHeader);
            const wav = new Blob([head, ...tail], { type: "audio/wav" });
            const wavBytes = new Uint8Array(await wav.arrayBuffer());
            const transcriptionResult = await this.getWhisperTranscription(
                wavBytes,
                session.fullTranscription ?? "",
            );

            if (signal.aborted) {
                console.log("Transcription aborted for segment:", segmentId);
                return;
            }

            if (transcriptionResult) {
                const { transcription, segments: transcriptionSegments } =
                    transcriptionResult;
                TranscriptionService.handleTranscription(
                    socket,
                    session,
                    transcription,
                    transcriptionSegments,
                    isPartial,
                    segmentId,
                );
            }
        } catch (error) {
            WebSocketService.sendMessage(
                socket,
                "ERROR",
                `Error processing ${
                    isPartial ? "segment" : "utterance"
                }: ${error}`,
            );
        }
    }

    static async getWhisperTranscription(
        webmData: Uint8Array,
        initialPrompt: string = "",
    ): Promise<
        {
            transcription: string;
            segments: { text: string; start: number; end: number }[];
        }
    > {
        const whisperUrl = new URL(
            (Deno.env.get("WHISPER_HOST") ?? "http://localhost:9000") + "/asr",
        );
        whisperUrl.searchParams.append("language", "en");
        whisperUrl.searchParams.append("initial_prompt", initialPrompt);
        whisperUrl.searchParams.append("output", "json");
        const wavFile = new File([webmData], "audio.wav");

        const body = new FormData();
        body.append("audio_file", wavFile);

        const whisperResponse = await fetch(whisperUrl.toString(), {
            method: "POST",
            body: body,
        });

        if (!whisperResponse.ok) {
            throw new Error(
                `Error transcribing audio: ${whisperResponse.statusText}`,
            );
        }

        const transcriptionResult = await whisperResponse.json();
        return {
            transcription: transcriptionResult.text.trim(),
            segments: transcriptionResult.segments.map((segment: any) => ({
                text: segment.text,
                start: segment.start,
                end: segment.end,
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

        const output = await process.output();

        if (!output.success) {
            const errorMessage = new TextDecoder().decode(output.stderr);
            throw new Error(`Failed to convert WebM to WAV: ${errorMessage}`);
        }

        return output.stdout;
    }

    static stripWavHeader(wavData: Uint8Array): Uint8Array {
        return wavData.slice(44);
    }
}
