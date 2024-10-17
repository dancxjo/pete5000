import { Handlers } from "$fresh/server.ts";
import { Transcript } from "../../lib/Transcript.ts";
import { pino } from "npm:pino";

const logger = pino({ level: "debug" });

interface Conversation {
    transcript: Transcript;
}

const sessions = new Map<WebSocket, Conversation>();

interface FragmentMessage {
    type: "FRAGMENT" | "SEGMENT";
    data: string; // base64-encoded Webm data
    timestamp?: string; // ISO 8601
}

let counter = Date.now();

export const handler: Handlers = {
    async GET(req, _ctx) {
        logger.info("Received GET request to upgrade to WebSocket");
        const { socket, response } = Deno.upgradeWebSocket(req);

        setupWebSocket(socket);

        return response;
    },
};

function setupWebSocket(socket: WebSocket) {
    logger.debug("Setting up WebSocket");
    socket.onopen = () => {
        let was = "";
        setInterval(() => {
            const now = sessions.get(socket)?.transcript.visualize();
            if (now !== was) {
                was = now ?? "";
            }
            sessions.get(socket)?.transcript.contract();
        });
    };
    socket.onclose = () => handleWebSocketClose(socket);
    socket.onerror = (err) => handleWebSocketError(socket, err);
    socket.onmessage = (event) => handleWebSocketMessage(socket, event);
}

function handleWebSocketClose(socket: WebSocket) {
    logger.info("WebSocket connection closed");
    sessions.delete(socket);
}

function handleWebSocketError(socket: WebSocket, err: Event) {
    logger.error({ err }, "WebSocket error occurred");
    sessions.delete(socket);
}

async function handleWebSocketMessage(socket: WebSocket, event: MessageEvent) {
    logger.debug("Received WebSocket message");
    try {
        const message = parseFragmentMessage(event.data);
        if (!message) {
            logger.warn("Invalid message format received");
            return;
        }

        logger.info("Valid fragment message received");
        const decodedData = decodeBase64WebMData(message.data);
        logger.debug("Decoded base64 WebM data");

        addFragmentToConversation(socket, decodedData);
    } catch (err) {
        logger.error({ err }, "Error handling WebSocket message");
        sendErrorMessage(socket, "Failed to process the audio fragment.");
    }
}

function parseFragmentMessage(data: string): FragmentMessage | null {
    try {
        const message: FragmentMessage = JSON.parse(data);
        if (isValidControlMessage(message)) {
            return message;
        } else {
            logger.warn("Received message is not a valid control message");
            return null;
        }
    } catch (err) {
        logger.error({ err }, "Failed to parse fragment message");
        return null;
    }
}

function isValidControlMessage(message: unknown): message is FragmentMessage {
    return !!message && typeof message === "object" && "type" in message &&
        (message.type === "FRAGMENT" || message.type === "SEGMENT") &&
        "data" in message && typeof message.data === "string";
}

function decodeBase64WebMData(data: string): Uint8Array {
    logger.debug("Decoding base64 WebM data");
    return Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
}

function addFragmentToConversation(socket: WebSocket, webmData: Uint8Array) {
    logger.info("Adding fragment to conversation transcript");
    if (!sessions.has(socket)) {
        logger.info("Creating new conversation for WebSocket");
        const transcript = new Transcript({
            onError: (err) => {
                logger.error({ err }, "Transcript error occurred");
                sendErrorMessage(socket, err.message);
            },
            onNewPrediction: (prediction) => {
                logger.debug(
                    prediction,
                    "Sending new prediction to client",
                );
                socket.send(
                    JSON.stringify({
                        type: "NEW_PREDICTION",
                        data: prediction.text,
                    }),
                );
            },
            onStableFragment: (fragment) => {
                logger.debug(
                    "Sending stable fragment transcription to client",
                );
                socket.send(
                    JSON.stringify({
                        type: "TRANSCRIPTION",
                        data: fragment,
                    }),
                );
            },
        });

        sessions.set(socket, { transcript });
    }
    const conversation = sessions.get(socket);

    if (!conversation) {
        logger.error("No conversation found for the WebSocket");
        return;
    }

    logger.debug("Adding fragment to conversation transcript");
    conversation.transcript.pushWebm(webmData, new Date()).then(() => {
        logger.info("Fragment added to conversation");
        // conversation.transcript.transcribe().then((transcription) => {
        //     logger.info({ transcription }, "Conversation transcribed");
        // }).catch((err) => {
        //     logger.error({ err }, "Failed to transcribe conversation");
        // });
    }).catch((err) => {
        logger.error({ err }, "Failed to add fragment to conversation");
        sendErrorMessage(socket, err.message);
    });
}

function sendErrorMessage(socket: WebSocket, message: string) {
    logger.warn({ message }, "Sending error message to client");
    socket.send(
        JSON.stringify({
            type: "ERROR",
            message,
        }),
    );
}
