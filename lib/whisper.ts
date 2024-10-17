import { pino } from "npm:pino";

const logger = pino({ level: "debug" });

export interface TranscribedSegment {
    id: number;
    seek: number;
    start: number;
    end: number;
    text: string;
    tokens: number[];
    temperature: number;
    avg_logprob: number;
    compression_ratio: number;
    no_speech_prob: number;
}

export interface Transcription {
    text: string;
    segments: TranscribedSegment[];
    language: string;
}

export async function getTranscription(
    wavData: Uint8Array,
    initialPrompt: string = "",
    signal?: AbortSignal,
): Promise<Transcription> {
    if (!(wavData instanceof Uint8Array) || wavData.length < 44) {
        throw new Error("Invalid WAV data provided for transcription.");
    }

    const whisperUrl = new URL(
        (Deno.env.get("WHISPER_HOST") ?? "http://localhost:9000") + "/asr",
    );
    // whisperUrl.searchParams.append("language", "en");
    whisperUrl.searchParams.append("initial_prompt", initialPrompt);
    whisperUrl.searchParams.append("output", "json");
    const wavFile = new File([wavData], "audio.wav");

    const body = new FormData();
    body.append("audio_file", wavFile);

    logger.debug("Transcribing audio with initial prompt: %s", initialPrompt);
    const whisperResponse = await fetch(whisperUrl.toString(), {
        method: "POST",
        body: body,
        signal,
    });

    if (!whisperResponse.ok) {
        const errorText = await whisperResponse.text();
        logger.error(errorText, "Error transcribing audio");
        throw new Error(
            `Error transcribing audio: ${whisperResponse.statusText} - ${errorText}`,
        );
    }

    try {
        const obj = await whisperResponse.json();
        logger.debug(obj, "Received Whisper response");
        return obj;
    } catch (error) {
        logger.error(error, "Error parsing Whisper response");
        throw new Error("Error parsing Whisper response");
    }
}
