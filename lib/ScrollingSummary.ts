import { Ollama } from "npm:ollama";
import { Queue } from "./Queue.ts";
import { Detail, Scroll, Summary } from "./Scroll.ts";

const ollama = new Ollama({
    host: Deno.env.get("OLLAMA_HOST") ?? "http://localhost:11434",
});

// ScrollingSummary class definition
export class ScrollingSummary extends Scroll<Summary[], Detail[], Detail[]> {
    constructor(
        titulus: string = "Summarizing Topics",
        promptTemplate: string =
            "You are a highly capable summarizer with expertise in analyzing and structuring complex information. Your task is to segment the provided text into a clear stream of topics, generating one-paragraph summaries for each topic in the order they appear. Include the context of previous information to ensure coherence. Provided context: {{scroll}}",
    ) {
        super(
            new Queue<Detail[]>(),
            new Queue<Summary[]>(),
            new Queue<Detail[]>(),
            (data: Detail[]) => data,
            titulus,
        );
        this.promptTemplate = promptTemplate;
    }

    private promptTemplate: string;

    async summarize(): Promise<void> {
        const prompt = this.promptTemplate.replace(
            "{{scroll}}",
            this.toString(),
        );
        const model = Deno.env.get("SUMMARY_MODEL") ?? "llama3.2";
        const stream = await ollama.generate({ prompt, model, stream: true });
        for await (const chunk of stream) {
            this.top.push([chunk.response]);
        }
        console.log("Summarization complete.");
    }
}

if (import.meta.main) {
    const summary = new ScrollingSummary();
    summary.bufferToBottom("This is a test.");
    summary.bufferToBottom("This is another test.");
    summary.processVolume();
    summary.summarize();
}
