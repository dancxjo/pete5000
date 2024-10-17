import type { ClientSession } from "./ClientSessionService.ts";
import { UtilityService } from "./UtilityService.ts";
import { WebSocketService } from "./WebSocketService.ts";

export class TranscriptionService {
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

    static handleTranscription(
        socket: WebSocket,
        session: ClientSession,
        transcription: string,
        _segments: { text: string; start: number; end: number }[],
        isPartial: boolean,
    ) {
        if (isPartial) {
            WebSocketService.sendMessage(
                socket,
                "PREDICTION_UPDATE",
                transcription,
            );
        } else {
            session.fullTranscription = `${
                session.fullTranscription ?? ""
            } ${transcription}`.trim();
            WebSocketService.sendMessage(
                socket,
                "FINAL_TRANSCRIPTION",
                transcription,
            );
        }
    }

    static handleFinalTranscription(
        socket: WebSocket,
        session: ClientSession,
        segments: { text: string; start: number; end: number }[],
    ) {
        const fullText = segments.map((segment) => segment.text).join(" ");
        const sentences = UtilityService.splitIntoSentences(fullText);
        if (sentences.length >= 1) {
            const finalTranscription = sentences[0];
            session.fullTranscription = `${
                session.fullTranscription ?? ""
            } ${finalTranscription}`.trim();
            session.processedSegments += 1;
            WebSocketService.sendMessage(
                socket,
                "FINAL_TRANSCRIPTION",
                finalTranscription,
            );
        }
    }
}

export default TranscriptionService;
