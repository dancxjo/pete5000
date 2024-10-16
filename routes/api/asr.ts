// WebSocketHandler.ts

import { Handlers } from "$fresh/server.ts";
import { ws } from "../../islands/ws/signals.ts";
import { AudioProcessingService } from "../../lib/services/AudioProcessingService.ts";
import { Segment } from "./Segment.ts"; // Import the refactored Segment class

interface Conversation {
    head: Segment;
    tail: Segment;
}

const sessions = new Map<WebSocket, Conversation>();

interface SegmentMessage {
    type: "SEGMENT";
    data: string; // base64-encoded Webm data
    timestamp?: string; // ISO 8601
}

function isValidControlMessage(message: SegmentMessage): boolean {
    return message.type === "SEGMENT" && typeof message.data === "string";
}

let counter = Date.now();

export const handler: Handlers = {
    async GET(req, _ctx) {
        const { socket, response } = Deno.upgradeWebSocket(req);

        function alwaysBeTranscribing(segment: Segment) {
            const transcribe = async () => {
                console.log("Transcribing segment...");
                const transcription = await segment.transcribe();
                socket.send(
                    JSON.stringify({
                        type: "FINAL_TRANSCRIPTION",
                        data: transcription,
                    }),
                );
                console.log("Active transcription complete:", transcription);
                setTimeout(transcribe, 600);
            };
            transcribe();
        }

        // Handle WebSocket closure
        socket.onclose = () => {
            sessions.delete(socket);
            console.log("WebSocket connection closed.");
        };

        // Handle WebSocket errors
        socket.onerror = (err) => {
            console.error("WebSocket error:", err);
            sessions.delete(socket);
        };

        // Handle incoming WebSocket messages
        socket.onmessage = async (event) => {
            try {
                const data = event.data;
                const message: SegmentMessage = JSON.parse(data);

                // Validate the incoming message
                if (!isValidControlMessage(message)) {
                    return;
                }

                // Decode the base64-encoded WebM data into a Uint8Array
                const decodedData = Uint8Array.from(
                    atob(message.data),
                    (c) => c.charCodeAt(0),
                );

                // Create a new Segment instance
                const segment = await Segment.fromWebm(
                    decodedData,
                    new Date(message.timestamp ?? Date.now()),
                );

                if (!sessions.has(socket)) {
                    sessions.set(socket, { head: segment, tail: segment });
                    alwaysBeTranscribing(segment);
                }
                const conversation = sessions.get(socket);

                if (!conversation) {
                    console.error("No conversation found for the WebSocket.");
                    return;
                }

                conversation.tail.next = segment;
                conversation.tail = segment;
                console.log(conversation.head.length);
            } catch (err) {
                console.error("Error handling WebSocket message:", err);
                // Optionally, send an error message back to the client
                socket.send(
                    JSON.stringify({
                        type: "ERROR",
                        message: "Failed to process the audio segment.",
                    }),
                );
            }
        };

        return response;
    },
};
