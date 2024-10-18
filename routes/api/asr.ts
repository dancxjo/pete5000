import { Handlers } from "$fresh/server.ts";
import { pino } from "npm:pino";
import { ClientConnection } from "../../lib/ClientConnection.ts";
const logger = pino({ level: "debug" });

const sessions = new Map<WebSocket, ClientConnection>();

export const handler: Handlers = {
    async GET(req, _ctx) {
        logger.info("Received GET request to upgrade to WebSocket");
        const { socket, response } = Deno.upgradeWebSocket(req);

        if (!socket) {
            logger.error("Failed to upgrade to WebSocket");
            return response;
        }

        if (!sessions.has(socket)) {
            logger.info("Creating new ClientConnection for WebSocket");
            const client = new ClientConnection(socket);
            sessions.set(socket, client);
        }

        const client = sessions.get(socket);

        if (!client) {
            logger.error("Failed to find ClientConnection for WebSocket");
            return response;
        }

        return response;
    },
};
