import { AudioProcessingService } from "../../lib/services/AudioProcessingService.ts";

interface Transcription {
    transcription: string;
    segments: {
        text: string;
        start: number;
        end: number;
    }[];
}

export class Segment {
    public left: Segment | null = null;
    public right: Segment | null = null;
    readonly transcriptions: { [transcription: string]: Transcription[] } = {};

    static async fromWebm(webmData: Uint8Array, timestamp?: Date) {
        const wavData = await AudioProcessingService.convertWebmToWav(webmData);
        return new Segment(wavData, timestamp ?? new Date());
    }

    constructor(readonly wavData: Uint8Array, protected timestamp: Date) {
    }

    async transcribe(initialPrompt: string = ""): Promise<string> {
        console.log("Transcribing segment...");
        const transcription = await AudioProcessingService
            .getWhisperTranscription(this.wavData, initialPrompt);
        const transcribedText = transcription.transcription;

        if (!this.transcriptions[transcription.transcription]) {
            this.transcriptions[transcribedText] = [];
        }
        this.transcriptions[transcribedText].push(transcription);
        return transcribedText;
    }
}

export function generateMermaidTree(
    node: Segment,
    nodeId = "A",
    result = [],
): string {
    if (!node) return "";

    const transcription = node.transcriptions
        ? `"${Object.keys(node.transcriptions)[0]}"`
        : '"[No transcription]"';
    result.push(`${nodeId}["${transcription}"]`);

    if (node.left) {
        const leftId = `${nodeId}L`;
        result.push(`${nodeId} --> ${leftId}`);
        generateMermaidTree(node.left, leftId, result);
    }

    if (node.right) {
        const rightId = `${nodeId}R`;
        result.push(`${nodeId} --> ${rightId}`);
        generateMermaidTree(node.right, rightId, result);
    }

    return `graph TD\n${result.join("\n")}`;
}
