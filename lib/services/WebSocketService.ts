import { base64ToArrayBuffer } from "../buffer_transformations.ts";
import { AudioProcessingService } from "./AudioProcessingService.ts";
import {
    type ClientSession,
    ClientSessionService,
} from "./ClientSessionService.ts";
import { type ControlMessage, UtilityService } from "./UtilityService.ts";

export class WebSocketService {
    static setupWebSocketHandlers(
        socket: WebSocket,
        sessions: Map<WebSocket, ClientSession>,
    ) {
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
        sessions.set(socket, ClientSessionService.createClientSession());
    }

    static handleWebSocketMessage(
        socket: WebSocket,
        message: string,
        sessions: Map<WebSocket, ClientSession>,
    ) {
        const session = sessions.get(socket);
        if (!session) return;

        try {
            const controlMessage = JSON.parse(message);
            if (!UtilityService.isValidControlMessage(controlMessage)) {
                console.log("Invalid control message:", message);
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
        // UtilityService.throttle(() => {
        const message = { type, data, ...additionalData };
        if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(message));
        } else {
            console.warn(
                "Attempted to send message on a closed WebSocket:",
                message,
            );
        }
        // }, 200);
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
                break;
            case "SEGMENT":
            case "UTTERANCE":
                this.handleAudioData(socket, session, controlMessage);
                break;
            default:
                console.log(
                    "Unknown control message type:",
                    controlMessage.type,
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

        // Save the segment data
        const data = base64ToArrayBuffer(controlMessage.data);
        session.segments.push(data);
        console.log(
            "Segment data saved. Total segments:",
            session.segments.length,
        );

        // Check if enough segments have been accumulated
        if (session.segments.length >= 1) { // Example threshold, adjust as needed
            const accumulatedSegments = session.segments.slice();
            session.segments = []; // Clear the segment queue after accumulating

            // Abort the previous transcription process if it exists
            ClientSessionService.abortPreviousTranscription(session);

            // Start processing the accumulated segments
            AudioProcessingService.processAudio(
                socket,
                session,
                accumulatedSegments.length,
                accumulatedSegments,
                controlMessage.type === "SEGMENT",
            );
        }
    }
}
