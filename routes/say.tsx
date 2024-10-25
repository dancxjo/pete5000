import { Handlers, type PageProps } from "$fresh/server.ts";
import { v4 } from "npm:uuid";
import { pino } from "npm:pino";
import { TranscriptionSession } from "../lib/SocketToClient.ts";
import { type GuessMessage, MessageType } from "../lib/socket_messages.ts";
import LanguageProcessingComponent from "../lib/lpc.ts";

interface Props {
    message: string | null;
    lastThought: string | null;
}

const lpc = new LanguageProcessingComponent("templates");

const logger = pino(
    { level: "debug" },
);

export const handler: Handlers = {
    async POST(req, ctx) {
        const form = await req.formData();
        const message = form.get("q")?.toString();
        const url = new URL(req.url);

        if (!message) {
            return ctx.render({ message: "No message" });
        }
        const descriptionOfRequest =
            `You hear (on your web interface "ears"): ${message}`;
        logger.debug(descriptionOfRequest);
        await lpc.feels(descriptionOfRequest, url.toString());
        await lpc.tick();
        const lastThought = await lpc.lastThought();
        return ctx.render({ message, lastThought });
    },
};

export default function SimpleChatForm(props: PageProps<Props>) {
    const { message, lastThought } = props.data ?? {};
    return (
        <div>
            <h1>Simple Chat</h1>
            <blockquote>{message}</blockquote>
            <p>🧠💭({lastThought})</p>

            <form
                method="POST"
                style="display: flex; justify-content: space-between;"
            >
                <input type="text" name="q" style="width: 100%" />
                <button type="submit">Send</button>
            </form>
        </div>
    );
}
