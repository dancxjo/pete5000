import {
    getTranscription,
    type TranscribedSegment,
    type Transcription,
} from "./whisper.ts";
import { clip, decodeWebm, detectSilence, toWav } from "./audio_processing.ts";
import { pino } from "npm:pino";
import { Subject } from "npm:rxjs";

export const logger = pino({
    level: "debug",
});

export class Clip {
    private _transcription?: Transcription;

    private segmentSubject = new Subject<Clip>();

    static fromAudioBuffer(
        buffer: AudioBuffer,
        recordedAt: Date,
        startS?: number,
        endS?: number,
    ) {
        return new Clip(
            buffer,
            recordedAt,
            startS ?? 0,
            endS ?? buffer.duration,
        );
    }

    static async fromEncodedWebm(encodedWebM: string, recordedAt: Date) {
        const webm = Uint8Array.from(atob(encodedWebM), (c) => c.charCodeAt(0));
        const buffer = await decodeWebm(webm);
        return Clip.fromAudioBuffer(buffer, recordedAt);
    }

    static fromWhisperTranscribedSegment(
        parentClip: Clip,
        segment: TranscribedSegment,
    ) {
        const clip = new Clip(
            parentClip.container,
            new Date(parentClip.recordedAt.getTime() + (segment.start * 1000)),
            segment.start,
            segment.end,
            segment.text,
        );
        return clip;
    }

    constructor(
        public readonly container: AudioBuffer, // a reference to the audiobuffer that contains us
        public readonly recordedAt: Date,
        public readonly startS: number,
        public readonly endS: number,
        protected alreadyTranscribedText?: string,
    ) {}

    get durationS() {
        return this.endS - this.startS;
    }

    get endedAt() {
        return new Date(this.recordedAt.getTime() + this.durationS * 1000);
    }

    get asWav() {
        return toWav(this.container);
    }

    get asAudioBuffer() {
        return clip(
            this.container,
            this.startS * this.container.sampleRate,
            this.container.sampleRate * this.endS,
        );
    }

    isSilent(threshold: number = 0.01): boolean {
        const buffer = this.asAudioBuffer;
        return detectSilence(buffer, threshold);
    }

    transcribe(fullContext: string = ""): Promise<Transcription | null> {
        if (this.isSilent()) {
            logger.debug("Clip is silent, skipping transcription.");
            return Promise.resolve(null);
        }
        const willTranscribe = getTranscription(this.asWav, fullContext).then(
            (transcription) => {
                for (const segment of transcription.segments) {
                    const newClip = Clip.fromWhisperTranscribedSegment(
                        this,
                        segment,
                    );
                    // Check if the segmentSubject is closed before emitting
                    if (!this.segmentSubject.closed) {
                        logger.debug(
                            `Emitting new clip from segment: ${segment.start}s to ${segment.end}s`,
                        );
                        this.segmentSubject.next(newClip);
                    } else {
                        logger.warn(
                            "Attempted to emit to a closed segmentSubject",
                        );
                    }
                }
                return transcription;
            },
        ).catch((e) => {
            logger.error("Failed to transcribe clip: %s", e);
            return null;
        });
        return willTranscribe;
    }

    get isTranscribed() {
        return this.alreadyTranscribedText || this._transcription !== undefined;
    }

    get text(): string | null {
        return this.alreadyTranscribedText || this._transcription?.text || null;
    }

    get clips$() {
        return this.segmentSubject.asObservable();
    }
}
