import { Handlers } from "$fresh/server.ts";
import type { ClientSession } from "../../lib/services/ClientSessionService.ts";
import { WebSocketService } from "../../lib/services/WebSocketService.ts";

const sessions = new Map<WebSocket, ClientSession>();

export const handler: Handlers = {
    async GET(req, _ctx) {
        const { socket, response } = Deno.upgradeWebSocket(req);
        WebSocketService.setupWebSocketHandlers(socket, sessions);
        return response;
    },
};
