import { AudioProcessingService } from "../../lib/services/AudioProcessingService.ts";

export class Segment {
    static counter = Date.now();
    static async fromWebm(
        webmData: Uint8Array,
        recordedAt: Date,
    ): Promise<Segment> {
        const buffer = await AudioProcessingService.decodeWebm(webmData);
        return new Segment(buffer, recordedAt);
    }

    protected next: Segment | null = null;

    constructor(
        readonly buffer: AudioBuffer,
        readonly recordedAt: Date,
    ) {}

    get duration(): number {
        // if (!this.next) {
        return this.buffer.duration;
        // }
        // if (this === this.next) {
        //     throw new Error("Circular reference detected in segment chain.");
        // }
        // return this.buffer.duration + this.next.duration;
    }

    get audioBuffer(): AudioBuffer {
        // if (!this.next) {
        return this.buffer;
        // }
        // if (this === this.next) {
        //     throw new Error("Circular reference detected in segment chain.");
        // }
        // const context = new AudioContext();
        // const outputBuffer = context.createBuffer(
        //     1,
        //     this.buffer.length + this.next.buffer.length,
        //     this.buffer.sampleRate,
        // );
        // const outputData = outputBuffer.getChannelData(0);
        // const buffer1Data = this.buffer.getChannelData(0);
        // const buffer2Data = this.next.buffer.getChannelData(0);
        // outputData.set(buffer1Data);
        // outputData.set(buffer2Data, this.buffer.length);
        // return outputBuffer;
    }

    get tail(): Segment {
        if (!this.next) {
            return this;
        }
        if (this === this.next) {
            throw new Error("Circular reference detected in segment chain.");
        }
        return this.next;
    }

    push(segment: Segment): void {
        if (this.next) {
            this.next.push(segment);
        } else {
            this.next = segment;
        }
    }

    get toBeWavData(): Promise<Uint8Array> {
        return AudioProcessingService.toWav(this.audioBuffer);
    }

    async writeWav(): Promise<void> {
        Deno.writeFileSync(
            `./audio-segments/audio-${Segment.counter++}.wav`,
            await this.toBeWavData,
        );
    }
}
