import { Handlers } from "$fresh/server.ts";
import { v4 } from "npm:uuid";
import { pino } from "npm:pino";
import { TranscriptionSession } from "../lib/SocketToClient.ts";
import { type GuessMessage, MessageType } from "../lib/socket_messages.ts";
import LanguageProcessingComponent from "../lib/lpc.ts";
import { last } from "npm:rxjs";

const lpc = new LanguageProcessingComponent("templates");

const logger = pino(
    { level: "debug" },
);

export const handler: Handlers = {
    async GET(req, _ctx) {
        const descriptionOfRequest = `Received GET request: ${
            JSON.stringify(req)
        }`;
        logger.debug(descriptionOfRequest);
        await lpc.feels(descriptionOfRequest, req.url);
        await lpc.tick();
        const lastThought = await lpc.lastThought();
        return new Response(lastThought.content);
    },
};
