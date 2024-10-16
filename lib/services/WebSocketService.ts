import { base64ToArrayBuffer } from "../buffer_transformations.ts";
import {
    type ClientSession,
    ClientSessionService,
} from "./ClientSessionService.ts";
import { type ControlMessage, UtilityService } from "./UtilityService.ts";
import ContinuousTranscription from "./ContinuousTranscription.ts";
import { computeDiff } from "../diff_utils.ts"; // Import diff utility function

export class WebSocketService {
    static setupWebSocketHandlers(
        socket: WebSocket,
        sessions: Map<WebSocket, ClientSession>,
    ) {
        // Add a handler to clean up when the WebSocket closes
        socket.addEventListener("close", () => {
            sessions.delete(socket); // Remove the session when the socket closes
            console.log("WebSocket closed and session removed.");
        });

        // Example timeout to remove inactive sessions after 10 minutes
        setTimeout(() => {
            if (sessions.has(socket)) {
                sessions.delete(socket);
                console.log("Session timed out and removed.");
                socket.close(); // Close the socket if it's still open
            }
        }, 10 * 60 * 1000); // 10 minutes

        socket.onopen = () => this.handleWebSocketOpen(socket, sessions);
        socket.onmessage = (event) =>
            this.handleWebSocketMessage(socket, event.data, sessions);
        socket.onclose = (event) =>
            this.handleWebSocketClose(socket, event, sessions);
        socket.onerror = (err) =>
            this.handleWebSocketError(socket, err, sessions);
    }

    static handleWebSocketOpen(
        socket: WebSocket,
        sessions: Map<WebSocket, ClientSession>,
    ) {
        console.log("WebSocket connection opened");
        const clientSession = ClientSessionService.createClientSession();
        sessions.set(socket, clientSession);

        // Initialize ContinuousTranscription instance for the session
        clientSession.transcriptionService = new ContinuousTranscription(
            async (finalTranscription) => {
                this.sendMessage(
                    socket,
                    "FINAL_TRANSCRIPTION",
                    finalTranscription,
                );
            },
            (prediction) => {
                // Compute the diff between stable and current prediction
                const diff = computeDiff(
                    clientSession.transcriptionService?.stableTranscription ||
                        "",
                    prediction,
                );
                this.sendMessage(socket, "PREDICTION_UPDATE", diff);
            },
        );
    }

    static handleWebSocketMessage(
        socket: WebSocket,
        message: string,
        sessions: Map<WebSocket, ClientSession>,
    ) {
        const session = sessions.get(socket);
        if (!session) return;

        try {
            const controlMessage: ControlMessage = JSON.parse(message);
            if (!UtilityService.isValidControlMessage(controlMessage)) {
                // Ignore this message wasn't meant for us
                return;
            }
            this.processAudioMessage(socket, session, controlMessage);
        } catch (error) {
            console.error("Error processing control message:", error);
            this.sendMessage(
                socket,
                "ERROR",
                "Error processing control message",
            );
        }
    }

    static handleAudioData(
        socket: WebSocket,
        session: ClientSession,
        controlMessage: ControlMessage,
    ) {
        console.log(`Received ${controlMessage.type.toLowerCase()} data`);
        if (!controlMessage.data) {
            console.log("No data in message");
            return;
        }

        // Convert the base64 data to Uint8Array
        const segment = new Uint8Array(
            base64ToArrayBuffer(controlMessage.data),
        );

        // Push the segment to the transcription service
        session.transcriptionService?.push(segment).catch((error) => {
            console.error("Error pushing audio segment:", error);
        });
    }

    static handleWebSocketClose(
        socket: WebSocket,
        event: CloseEvent,
        sessions: Map<WebSocket, ClientSession>,
    ) {
        console.log("WebSocket connection closed", event.code, event.reason);
        sessions.delete(socket);
    }

    static handleWebSocketError(
        socket: WebSocket,
        err: Event | Error,
        sessions: Map<WebSocket, ClientSession>,
    ) {
        console.error("WebSocket error:", err);
        sessions.delete(socket);
    }

    static sendMessage(
        socket: WebSocket,
        type: string,
        data: string,
        additionalData?: Record<string, unknown>,
    ) {
        const message = { type, data, ...additionalData };
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(message));
        } else {
            console.warn(
                "Attempted to send message on a closed WebSocket:",
                message,
            );
        }
    }

    static processAudioMessage(
        socket: WebSocket,
        session: ClientSession,
        controlMessage: ControlMessage,
    ) {
        switch (controlMessage.type) {
            case "VAD_START":
                ClientSessionService.startVAD(session);
                break;
            case "VAD_STOP":
                ClientSessionService.stopVAD(session);
                session.transcriptionService?.finalize().catch((error) => {
                    console.error("Error finalizing transcription:", error);
                });
                break;

            case "UTTERANCE":
                break;
            case "SEGMENT":
                this.handleAudioData(socket, session, controlMessage);
                break;
            default:
                console.log(
                    "Unknown control message type:",
                    controlMessage.type,
                );
        }
    }
}

export default WebSocketService;
