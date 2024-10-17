import { Ollama } from "npm:ollama";
import { pino } from "npm:pino";
import { parseArgs } from "jsr:@std/cli/parse-args";

const ollama = new Ollama({
    host: Deno.env.get("OLLAMA_HOST") ?? "http://localhost:11434",
});

// Set up logger
const logger = pino({ level: "silent" });

type Detail = string;
type Summary = string;

// Parse command-line arguments
const args = parseArgs(Deno.args);
const titulus = args.titulus ||
    "You are a highly capable summarizer with expertise in analyzing and structuring complex information. Your task is to segment the provided text into a clear stream of topics, generating one-paragraph summaries for each topic in the order they appear. Include the context of previous information to ensure coherence.";

class Rotulus {
    spindles: {
        top: TransformStream<Uint8Array, Uint8Array>;
        bottom: TransformStream<Uint8Array, Uint8Array>;
    };
    page: TransformStream<Uint8Array, Uint8Array>;
    pageHeight: number;

    constructor(pageHeight: number) {
        this.spindles = {
            top: new TransformStream(),
            bottom: new TransformStream(),
        };
        this.page = new TransformStream();
        this.pageHeight = pageHeight;

        this.connectStreams();
    }

    // Connects the bottom spindle to the page and the page to the top spindle
    connectStreams(): void {
        this.spindles.bottom.readable.pipeTo(this.page.writable);
        this.page.readable.pipeTo(this.spindles.top.writable);
    }

    // Adds data to the bottom spindle
    async addToBottom(data: string): Promise<void> {
        const writer = this.spindles.bottom.writable.getWriter();
        await writer.write(new TextEncoder().encode(data));
        writer.releaseLock();
    }

    // Processes data as it is added from bottom to top
    async processScroll(): Promise<void> {
        const reader = this.spindles.top.readable.getReader();
        let count = 0;

        while (count < this.pageHeight) {
            const { value: data, done } = await reader.read();
            if (done) break;
            await Deno.stdout.write(data);
            count++;
        }
        reader.releaseLock();
    }

    // Gets the current state of the rotulus
    getState(): {
        top: TransformStream<Uint8Array, Uint8Array>;
        bottom: TransformStream<Uint8Array, Uint8Array>;
        page: TransformStream<Uint8Array, Uint8Array>;
    } {
        return {
            top: this.spindles.top,
            bottom: this.spindles.bottom,
            page: this.page,
        };
    }
}

class ScrollingSummary extends Rotulus {
    details: Detail[];
    summaries: Summary[];
    private promptTemplate: string;

    constructor(
        pageHeight: number,
        titulus: string,
        promptTemplate: string = "{{titulus}} Provided context: {{scroll}}",
    ) {
        super(pageHeight);
        this.details = [];
        this.summaries = [];
        this.promptTemplate = promptTemplate.replace("{{titulus}}", titulus);
    }

    // Adds detail to the list of details
    addDetail(detail: Detail): void {
        this.details.push(detail);
    }

    // Adds summary to the list of summaries
    addSummary(summary: Summary): void {
        this.summaries.push(summary);
    }

    // Summarizes the current scroll using Ollama
    async summarize(): Promise<void> {
        const pageReader = this.page.readable.getReader();
        let pageContent = "";
        while (true) {
            const { value, done } = await pageReader.read();
            if (done) break;
            pageContent += new TextDecoder().decode(value) + " ";
        }
        pageReader.releaseLock();

        if (pageContent.length === 0) {
            return;
        }
        const prompt = this.promptTemplate.replace(
            "{{scroll}}",
            pageContent.trim(),
        );
        const model = Deno.env.get("SUMMARY_MODEL") ?? "llama3.2";
        try {
            const stream = await ollama.generate({
                prompt,
                model,
                stream: true,
            });
            for await (const chunk of stream) {
                this.addSummary(chunk.response);
            }
        } catch (error) {
            console.error(`Error during summarization: ${error.message}`);
        }
    }

    // Processes data continuously and triggers summarization if page is full
    async processStream(): Promise<void> {
        await this.processScroll();
        if (this.pageHeight >= this.pageHeight) {
            await this.summarize();
        }
    }

    // Gets the current state of the scrolling summary
    getSummaryState(): {
        details: Detail[];
        summaries: Summary[];
        top: TransformStream<Uint8Array, Uint8Array>;
        bottom: TransformStream<Uint8Array, Uint8Array>;
        page: TransformStream<Uint8Array, Uint8Array>;
    } {
        return {
            details: [...this.details],
            summaries: [...this.summaries],
            ...super.getState(),
        };
    }
}

// Example usage with Deno.stdin.readable to stream input to bottom spindle
async function pipeInputOutput(scrollingSummary: ScrollingSummary) {
    const inputReader = Deno.stdin.readable.getReader();
    const writer = scrollingSummary.spindles.bottom.writable.getWriter();

    while (true) {
        const { value, done } = await inputReader.read();
        if (done) break;
        await writer.write(value);
    }
    inputReader.releaseLock();
    writer.releaseLock();

    // Use a separate reader to avoid locking conflicts
    const topReader = scrollingSummary.spindles.top.readable.getReader();
    while (true) {
        const { value, done } = await topReader.read();
        if (done) break;
        await Deno.stdout.write(value);
    }
    topReader.releaseLock();
}

if (import.meta.main) {
    const scrollingSummary = new ScrollingSummary(
        2,
        titulus,
    );

    pipeInputOutput(scrollingSummary);
    scrollingSummary.processStream();
}
