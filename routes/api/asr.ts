// WebSocketHandler.ts

import { Handlers } from "$fresh/server.ts";
import { ws } from "../../islands/ws/signals.ts";
import { AudioProcessingService } from "../../lib/services/AudioProcessingService.ts";
import { generateMermaidTree, Segment } from "./Segment.ts"; // Import the refactored Segment class

interface Conversation {
    head: Segment;
    queue: Segment[];
    lastTranscription?: string;
    coveredSegments?: Set<Segment>;
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
                    sessions.set(socket, { head: segment, queue: [segment] });
                }
                const conversation = sessions.get(socket);

                if (!conversation) {
                    console.error("No conversation found for the WebSocket.");
                    return;
                }

                if (!conversation.head) {
                    conversation.head = segment;
                } else if (!conversation.head.left) {
                    conversation.head.left = segment;
                } else if (!conversation.head.right) {
                    conversation.head.right = segment;
                } else {
                    // Combine the WAV data from the head and the new segment
                    const newWavData = await AudioProcessingService
                        .combineWavData(
                            conversation.head.wavData,
                            segment.wavData,
                        );
                    // Create a new segment representing the combined data
                    const newHead = new Segment(
                        newWavData,
                        conversation.head.timestamp,
                    );
                    newHead.left = conversation.head;
                    newHead.right = segment;
                    conversation.head = newHead;
                }

                // Update the conversation queue
                conversation.queue.push(segment);

                while (conversation.queue.length > 0) {
                    const current = conversation.queue[0]; // Peek at the front of the queue

                    if (!current.left) {
                        current.left = segment;
                        conversation.queue.push(segment);
                        break;
                    } else if (!current.right) {
                        current.right = segment;
                        conversation.queue.push(segment);
                        break;
                    } else {
                        conversation.queue.shift(); // Remove the current node if both children are occupied
                    }
                }

                // Update the transcription from the new head of the tree
                conversation.lastTranscription = await conversation.head
                    .transcribe(conversation.lastTranscription);

                socket.send(
                    JSON.stringify({
                        type: "FINAL_TRANSCRIPTION",
                        data: conversation.lastTranscription,
                    }),
                );

                // Generate and send the Mermaid representation of the tree
                const mermaidTree = generateMermaidTree(conversation.head);
                socket.send(
                    JSON.stringify({ type: "tree", data: mermaidTree }),
                );
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

export function addSegmentBalanced(
    segment: Segment,
    conversation: Conversation,
) {
    while (conversation.queue.length > 0) {
        const current = conversation.queue[0]; // Peek at the front of the queue

        if (!current.left) {
            current.left = segment;
            conversation.queue.push(segment);
            break;
        } else if (!current.right) {
            current.right = segment;
            conversation.queue.push(segment);
            break;
        } else {
            conversation.queue.shift(); // Remove the current node if both children are occupied
        }
    }

    conversation.head = conversation.queue[0]; // Update head if necessary
}
