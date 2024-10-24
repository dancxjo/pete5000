import { pino } from "npm:pino";
import LanguageProcessingComponent from "../lib/lpc.ts";
import { signal } from "@preact/signals";
const logger = pino({ level: "debug" });
import Heart from "../islands/Heart.tsx";

const response = signal("");

export default async function HeartPage() {
    const lpc = new LanguageProcessingComponent("templates");
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

    await fetchRecentThoughts();

    return (
        <div>
            <Heart />
        </div>
    );
}
