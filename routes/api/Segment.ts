import { AudioProcessingService } from "../../lib/services/AudioProcessingService.ts";

let counter = Date.now();

interface Transcription {
    transcription: string;
    segments: {
        text: string;
        start: number;
        end: number;
    }[];
}

export class Segment {
    public next: Segment | null = null;
    protected transcriptions: { [transcription: string]: Transcription[] } = {};

    static async fromWebm(webmData: Uint8Array, timestamp?: Date) {
        const wavData = await AudioProcessingService.convertWebmToWav(webmData);
        // Deno.writeFileSync(
        //     `./recordings/direct_segment_${counter++}.wav`,
        //     wavData,
        // );
        return new Segment(wavData, timestamp ?? new Date());
    }

    constructor(protected wavData: Uint8Array, protected timestamp: Date) {
    }

    get length(): number {
        return (this.next?.length ?? 0) + 1;
    }

    // protected cachedWav: Uint8Array | null = null;
    async getWav(): Promise<Uint8Array> {
        let newWav = this.wavData;
        const head = this.wavData;
        if (this.next) {
            const tail = await this.next?.getWav() ?? new Uint8Array();
            newWav = await AudioProcessingService.combineWavData(
                head,
                tail,
            );
        }

        Deno.writeFileSync(
            `./recordings/combined_segment_${counter++}.wav`,
            newWav,
        );
        return newWav;
    }

    async transcribe(initialPrompt: string = ""): Promise<string> {
        // Deno.writeFileSync(
        //     `./recordings/segment_${counter++}.wav`,
        //     await this.getWav(),
        // );

        console.log("Transcribing segment...");
        // const willBeSupposedHead = this.next?.transcribe(initialPrompt);
        const transcription = await AudioProcessingService
            .getWhisperTranscription(await this.getWav(), initialPrompt);
        const transcribedText = transcription.transcription;

        if (!this.transcriptions[transcription.transcription]) {
            this.transcriptions[transcribedText] = [];
        }
        this.transcriptions[transcribedText].push(transcription);
        console.log("Transcription complete:", transcription);
        // Deno.writeTextFile(
        //     `./recordings/${transcription.transcription}.txt`,
        //     JSON.stringify(transcription),
        // );
        Deno.writeFileSync(
            `./recordings/transcribed_${counter++}.wav`,
            await this.getWav(),
        );
        // const supposedHead = await willBeSupposedHead;
        console.log({
            // supposedHead: supposedHead,
            transcribedText,
            stability: 0,
        });
        return transcribedText;
    }

    // The degree to which previous transcriptions' heads match this one
    get stability(): number {
        return 0;
    }
}
