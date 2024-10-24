import { Handlers } from "$fresh/server.ts";
import { v4 } from "npm:uuid";
import { pino } from "npm:pino";
import { TranscriptionSession } from "../../lib/SocketToClient.ts";
import { type GuessMessage, MessageType } from "../../lib/socket_messages.ts";
import LanguageProcessingComponent from "../../lib/lpc.ts";
import { Writable } from "node:stream";

const lpc = new LanguageProcessingComponent("templates");

// Create a custom writable stream
const customStream = new Writable({
    objectMode: true,
    write(chunk, encoding, callback) {
        // `chunk` is the log message object from Pino
        let message = chunk;

        try {
            const obj = JSON.parse(chunk);
            message = obj.msg;
        } catch (e: unknown) {}
        console.error({ message, chunk, encoding, callback }); // Log the message to the console
        lpc.feels(message, "log"); // Send the log to lpc.feel
        Deno.stderr.write(
            new TextEncoder().encode(JSON.stringify(chunk) + "\n"),
        ); // Pass the log to the standard output
        callback();
    },
});

const logger = pino(
    { level: "debug" },
    // customStream,
);

const sessions = new Map<WebSocket, TranscriptionSession>();

export const handler: Handlers = {
    async GET(req, _ctx) {
        logger.debug("Received GET request");
        if (!req.headers.get("upgrade")?.toLowerCase().includes("websocket")) {
            logger.error("Received non-WebSocket request");
            return new Response("Expected WebSocket request", {
                status: 400,
            });
        }
        logger.info("Received GET request to upgrade to WebSocket");
        const { socket, response } = Deno.upgradeWebSocket(req);

        logger.info("Upgrading to WebSocket");
        if (!socket) {
            logger.error("Failed to upgrade to WebSocket");
            return response;
        }

        if (!sessions.has(socket)) {
            logger.info("Creating new SocketToClient for WebSocket");
            const connection = new TranscriptionSession(socket);
            sessions.set(socket, connection);
        }
        logger.info("Found existing SocketToClient for WebSocket");

        const connection = sessions.get(socket);

        if (!connection) {
            logger.error("Failed to find a connection for the WebSocket");
            return response;
        }

        logger.info("Successfully upgraded to WebSocket");

        connection.onMessage(
            MessageType.LOCATION,
            async (location) =>
                lpc.feels(
                    location.data as unknown as string,
                    "web interface geolocator",
                ),
        );

        connection.guesses$.subscribe((transcribedClip) => {
            const text = transcribedClip.text;
            logger.debug("Received segment guess: %s", text);
            if (!text) {
                return;
            }
            lpc.feels(
                text,
                "web interface ears (transcription)",
                new Date(transcribedClip.recordedAt),
            );
            lpc.tick();
            const message: GuessMessage = {
                type: MessageType.GUESS,
                data: {
                    id: v4(),
                    title: "Transcription",
                    content: text,
                    start: new Date(transcribedClip.recordedAt).toISOString(),
                    end: transcribedClip.endedAt.toISOString(),
                },
            };
            connection.send(message);
        });

        return response;
    },
};
