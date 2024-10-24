import { pino } from "npm:pino";
import LanguageProcessingComponent from "../lib/lpc.ts";
import { useSignal } from "@preact/signals";

const logger = pino({ level: "debug" });

export default function Heart() {
    const lpc = new LanguageProcessingComponent("templates");
    const response = useSignal("");

    async function fetchRecentThoughts() {
        const query = `
            MATCH (t:Thought)
            RETURN t.instruction AS instruction, t.response AS response, t.timestamp AS timestamp
            ORDER BY t.timestamp DESC LIMIT 5
        `;
        try {
            const thoughts = await lpc.runCypher(query);
            response.value = thoughts.map((thought) =>
                `${thought.timestamp}: ${thought.instruction} -> ${thought.response}`
            ).join("\n");
        } catch (error) {
            logger.error("Error fetching recent thoughts", error);
        }
    }

    setInterval(async () => {
        await lpc.tick();
        await fetchRecentThoughts();
    }, 1000);

    return (
        <div>
            <h1>Recent Thoughts</h1>
            <div>{response.value}</div>
        </div>
    );
}
