import { Ollama } from "npm:ollama";
import hb from "npm:handlebars";
import neo4j from "npm:neo4j-driver";
import { pino } from "npm:pino";
import YAML from "npm:json-to-pretty-yaml";

const logger = pino({ level: "info" });

const neo4jUrl = Deno.env.get("NEO4J_HOST") ?? "bolt://localhost:7687";
const neo4jUser = Deno.env.get("NEO4J_USER") ?? "neo4j";
const neo4jPassword = Deno.env.get("NEO4J_PASSWORD") ?? "password";
const driver = neo4j.driver(
    neo4jUrl,
    neo4j.auth.basic(neo4jUser, neo4jPassword),
);

async function runCypher(query: string, params: object = {}) {
    const session = driver.session();
    try {
        const result = await session.run(query, params);
        return result.records.map((record) => {
            const obj = record.toObject();
            if (obj.timestamp) {
                // Format the timestamp as a concise string
                obj.timestamp = new Date(obj.timestamp).toLocaleString();
            }
            return obj;
        });
    } finally {
        await session.close();
    }
}

class LanguageProcessingComponent {
    private ollama: Ollama;
    private templateDirectory: string;
    private tickCounter: number;

    constructor(templateDirectory: string) {
        this.ollama = new Ollama({
            host: Deno.env.get("OLLAMA_HOST") ?? "http://localhost:11434",
        });
        this.templateDirectory = templateDirectory;
        this.tickCounter = 0;
    }

    async runCypher(query: string, params: object = {}) {
        return runCypher(query, params);
    }

    async instruct(
        instruction: string,
        parameters: { [key: string]: never } = {},
        template = "instruct.hb",
    ): Promise<string> {
        const templatePath = `${this.templateDirectory}/${template}`;
        const templateContent = new TextDecoder().decode(
            Deno.readFileSync(templatePath),
        );

        // Extract Cypher queries from the template
        const cypherQueries = templateContent.match(
            /{{#cypher\s*}}([\s\S]*?){{\/cypher}}/g,
        );
        const queryResults: { [query: string]: neo4j.RecordShape[] } = {};

        // Run each Cypher query asynchronously and store results
        if (cypherQueries) {
            for (const queryBlock of cypherQueries) {
                const query = queryBlock.replace(
                    /{{#cypher\s*}}|{{\/cypher}}/g,
                    "",
                )
                    .trim();
                logger.info(`Running query: ${query}`);
                queryResults[query] = await runCypher(query, {});
            }
        }

        // Render the prompt with precomputed results
        const parser = hb.compile(templateContent);
        hb.registerHelper("cypher", (context, ...args) => {
            const query = context.fn();
            logger.debug(`Query: ${query}`);
            return YAML.stringify(queryResults[query]);
        });

        const prompt = parser({
            how_soon_is_now: new Date().toISOString(),
            instructions: instruction,
            ...parameters,
        }, {});

        logger.debug(prompt, "This is the prompt");

        // Use Ollama for processing the prompt
        const { response } = await this.ollama.generate({
            prompt,
            model: "llama3.2",
        });

        // Log the response in the graph
        await this.logThought(instruction, response);

        return response;
    }

    async logThought(instruction: string, response: string) {
        const timestamp = new Date().toISOString();
        const query = `
            MERGE (t:Thought {timestamp: $timestamp, content: $response})
            MERGE (me:Self)
            MERGE (me)-[:THOUGHT]->(t)
        `;
        const params = {
            timestamp,
            response,
        };
        logger.info("Logging thought to the graph...");
        await runCypher(query, params);
    }

    feels(sensation: string, on: string, at: Date = new Date()) {
        if (!sensation || !on) {
            logger.error(
                { sensation, on },
                "Missing required parameters for feels()",
            );
            return;
        }
        return this.logSensation(on, sensation);
    }

    async logSensation(
        channel: string,
        description: string,
        at: Date = new Date(),
    ) {
        if (!channel || !description) {
            logger.error(
                { channel, description },
                "Missing required parameters for logSensation()",
            );
            return;
        }

        const timestamp = at.toISOString();
        const query = `
            MERGE (s:Sensation {id: $uniqueId})
            SET s.channel = $channel,
                s.description = $description,
                s.timestamp = $timestamp
            MERGE (me:Self)
            MERGE (me)-[rel:EXPERIENCED]->(s)
            ON CREATE SET rel.strength = 1
            ON MATCH SET rel.strength = coalesce(rel.strength, 0) + 1
        `;
        const roundedTimestamp = Math.floor(at.getTime() / 1500);
        const uniqueId = `${channel}-${description}-${roundedTimestamp}`;
        const params = {
            uniqueId,
            timestamp,
            channel,
            description,
        };
        logger.info("Logging sensation to the graph...");
        await runCypher(query, params);
    }

    async tick() {
        this.tickCounter++;
        logger.info(`Tick ${this.tickCounter}`);
        const response = await this.instruct(
            "Reflect on the current state and update ongoing thoughts.",
            {},
        );
        await this.logThought("Lightweight reflection", response);
    }
}

export default LanguageProcessingComponent;
