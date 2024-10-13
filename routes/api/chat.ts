import { Handlers } from "$fresh/server.ts";
import { v4 } from "npm:uuid";

interface TranscriptionRequest {
    id: string;
    text: string;
    status: "pending" | "canceled";
}

// A map to store transcription requests
const requests: Map<string, TranscriptionRequest> = new Map();

export const handler: Handlers = {
    async GET(req, _ctx) {
        // Upgrade the HTTP request to a WebSocket connection
        const { socket, response } = Deno.upgradeWebSocket(req);

        socket.onopen = () => {
            console.log("WebSocket connection opened");
        };

        socket.onmessage = async (event) => {
            console.log("WebSocket message received:", event.data);
        };

        socket.onclose = (event) => {
            console.log("WebSocket connection closed");
            // Clean up the requests map
        };

        socket.onerror = (err) => {
            console.error("WebSocket error:", err);
        };

        return response;
    },
};
