import ContinuousTranscription from "./ContinuousTranscription.ts";

export interface ClientSession {
    abortController: AbortController;
    isProcessing?: boolean;
    batchingTimeout: number | null;
    isRecording: boolean;
    lastActivity: number;
    fullTranscription?: string;
    latestSegmentEmitted?: number;
    processedSegments: number;
    transcriptionService?: ContinuousTranscription;
}

export class ClientSessionService {
    static createClientSession(): ClientSession {
        return {
            batchingTimeout: null,
            isRecording: false,
            lastActivity: Date.now(),
            abortController: new AbortController(),
            processedSegments: 0,
        };
    }

    static startVAD(session: ClientSession) {
        session.isRecording = true;
        console.log("VAD_START received");
    }

    static stopVAD(session: ClientSession) {
        session.isRecording = false;
        session.transcriptionService?.finalize().catch((error) => {
            console.error("Error finalizing transcription:", error);
        });
        console.log("VAD_STOP received");
    }

    static abortPreviousTranscription(session: ClientSession) {
        if (session.abortController) {
            session.abortController.abort();
        }
        session.abortController = new AbortController();
    }
}

export default ClientSessionService;
