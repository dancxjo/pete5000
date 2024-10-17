import { Queue } from "./Queue.ts";

// Type alias for details and summaries
export type Detail = string;
export type Summary = string;

// Scroll class definition
export class Scroll<V, T = V, B = V> {
    private bottomStream: ReadableStream<B>;
    private volumeStream: TransformStream<B, V>;
    private topStream: WritableStream<T>;
    public titulus: string;

    constructor(
        public volume: Queue<V> = new Queue<V>(),
        public top: Queue<T> = new Queue<T>(),
        public bottom: Queue<B> = new Queue<B>(),
        refineFn: (data: V) => T = (data: any) => data as unknown as T,
        titulus: string = "Default Titulus",
    ) {
        this.titulus = titulus;
        this.bottomStream = new ReadableStream<B>({
            start: (controller) => {
                while (!this.bottom.isEmpty()) {
                    const item = this.bottom.pull();
                    if (item) controller.enqueue(item);
                }
                controller.close();
            },
        });
        this.volumeStream = new TransformStream<B, V>({
            transform: (chunk, controller) => {
                controller.enqueue(chunk);
            },
        });
        this.topStream = new WritableStream<T>({
            write: (chunk) => {
                const refined = refineFn(chunk as unknown as V);
                this.top.push(refined);
            },
        });
    }

    processVolume(): void {
        this.bottomStream.pipeThrough(this.volumeStream).pipeTo(this.topStream)
            .then(() => {
                console.log("Processing complete.");
            });
    }

    bufferToBottom(item: B): void {
        this.bottom.push(item);
    }

    hasPendingData(): boolean {
        return !this.bottom.isEmpty() || !this.volume.isEmpty();
    }

    toString(): string {
        return `Titulus: ${this.titulus}\nBottom Spindle (archetypum): ${this.bottom.toString()}\nVolume (volumen): ${this.volume.toString()}\nTop Spindle (summa): ${this.top.toString()}`;
    }
}
