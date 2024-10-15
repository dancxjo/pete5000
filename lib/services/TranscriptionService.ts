import type { ClientSession } from "./ClientSessionService.ts";
import { UtilityService } from "./UtilityService.ts";
import { WebSocketService } from "./WebSocketService.ts";

export class TranscriptionService {
    static handleTranscription(
        socket: WebSocket,
        session: ClientSession,
        transcription: string,
        segments: { text: string; start: number; end: number }[],
        isPartial: boolean,
        segmentId: number,
    ) {
        if (isPartial) {
            WebSocketService.sendMessage(
                socket,
                "PRELIMINARY_TRANSCRIPTION",
                transcription,
                { basedOn: segmentId },
            );
            this.handleFinalTranscription(socket, session, segments);
        } else {
            session.fullTranscription = `${
                session.fullTranscription ?? ""
            } ${transcription}`.trim();
            WebSocketService.sendMessage(
                socket,
                "TRANSCRIPTION",
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
            session.segments = session.segments.slice(1);
            WebSocketService.sendMessage(
                socket,
                "PRELIMINARY_TRANSCRIPTION",
                finalTranscription,
            );
        }
    }
}
