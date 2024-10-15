export interface ClientSession {
    abortController: AbortController;
    segments: ArrayBuffer[];
    isRecording: boolean;
    lastActivity: number;
    fullTranscription?: string;
    latestSegmentEmitted?: number;
    processedSegments: number;
}

export class ClientSessionService {
    static createClientSession(): ClientSession {
        return {
            segments: [],
            isRecording: false,
            lastActivity: Date.now(),
            abortController: new AbortController(),
            processedSegments: 0,
        };
    }

    static startVAD(session: ClientSession) {
        session.isRecording = true;
        session.segments = [];
        console.log("VAD_START received");
    }

    static stopVAD(session: ClientSession) {
        session.isRecording = false;
        session.segments = [];
        console.log("VAD_STOP received");
    }

    static abortPreviousTranscription(session: ClientSession) {
        if (session.abortController) {
            session.abortController.abort();
        }
        session.abortController = new AbortController();
    }
}
