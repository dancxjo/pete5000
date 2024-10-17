import { clip, decodeWebm, join, toWav } from "./audio_processing.ts";
import type { TranscriptCallbacks } from "./TranscriptCallbacks.ts";
import {
    getTranscription,
    type TranscribedSegment,
    type Transcription,
} from "./whisper.ts";
import { pino } from "npm:pino";

const logger = pino({ level: "debug" });

let counter = Date.now();

/**
 * Represents a single fragment of an audio transcript, capable of managing transcriptions
 * and interacting with other fragments in a linked structure.
 */
export class Fragment {
    protected transcription?: Transcription;
    protected candidateTranscriptions: Transcription[] = []; // Store multiple transcription candidates
    protected bestTranscriptionIndex: number = 0; // Index to track the "best" transcription
    private abortController?: AbortController;
    private untranscribable: boolean = false;
    private transcriptionPromises: Promise<void>[] = []; // Store ongoing transcription promises

    constructor(
        protected buffer: AudioBuffer,
        protected timestamp: Date,
        protected next?: Fragment,
        private callbacks: TranscriptCallbacks = {},
    ) {
        logger.info("Fragment created with timestamp: %s", timestamp);
    }

    /**
     * Gets the last fragment in the chain.
     * @returns The tail fragment of the chain.
     */
    get tail(): Fragment {
        logger.trace("Getting tail fragment");
        return this.next ? this.next.tail : this;
    }

    /**
     * Gets the next fragment in the chain, if available.
     * @returns The next fragment or undefined if none.
     */
    getNext(): Fragment | undefined {
        logger.trace("Getting next fragment");
        return this.next;
    }

    /**
     * Gets the current transcription of this fragment.
     * @returns The transcription if available, or undefined.
     */
    getTranscription(): Transcription | undefined {
        logger.trace("Getting transcription");
        return this.transcription;
    }

    /**
     * Pushes a new fragment to the end of the current chain.
     * @param latestFragment - The fragment to be added.
     */
    push(latestFragment: Fragment) {
        logger.info("Pushing new fragment to the tail", { latestFragment });
        this.appendToTail(latestFragment);
    }

    /**
     * Recursively gets the full audio buffer by joining this fragment with subsequent ones.
     * @returns The complete AudioBuffer.
     */
    async getAudioBuffer(): Promise<AudioBuffer> {
        logger.trace("Getting audio buffer");
        if (this.next) {
            logger.debug("Joining audio buffers of current and next fragments");
            return join(this.buffer, await this.next.getAudioBuffer());
        }
        return this.buffer;
    }

    /**
     * Gets a specific segment of this fragment based on segment ID.
     * @param id - The segment ID to retrieve.
     * @returns The audio buffer for the specified segment.
     */
    getSegment(id: number): AudioBuffer {
        logger.info("Getting segment with ID: %d", id);
        const segment = this.findSegmentById(id);
        logger.debug("Found segment", { segment });
        return clip(this.buffer, segment.start, segment.end);
    }

    private appendToTail(fragment: Fragment) {
        logger.debug("Appending fragment to the tail", { fragment });
        if (!this.next) {
            this.next = fragment;
        } else {
            this.tail.next = fragment;
        }
        logger.info("Fragment successfully appended to the tail", {
            newTail: this.tail,
        });
    }

    /**
     * Writes the audio of this fragment out to a file.
     */
    async writeOut(): Promise<void> {
        const audioBuffer = await this.getAudioBuffer();
        logger.debug("Audio buffer obtained for writing out", {
            audioBufferLength: audioBuffer.length,
        });
        const audio = await toWav(audioBuffer);
        let name = `audio-${counter++}`;
        if (this.transcription?.text) {
            name = this.transcription.text.replace(/\s/g, "_");
        }
        logger.info("Writing out audio to file: %s", name);
        Deno.writeFileSync(`./audio-segments/${name}.wav`, audio);
    }

    /**
     * Transcribes this fragment, providing additional context if available.
     * @param fullContext - Additional context to use during transcription.
     */
    async transcribe(fullContext = "") {
        // Skip transcription if fragment is less than 1 second
        if (this.buffer.duration < 1) {
            logger.info(
                "Fragment is less than 1 second long, marking as untranscribable and accumulating",
                { duration: this.buffer.duration },
            );
            this.untranscribable = true;
            this.absorbNextFragment();
        }
        if (this.untranscribable) {
            logger.warn(
                "Fragment marked as untranscribable, skipping transcription",
            );
            return;
        }

        logger.info("Starting transcription", { fullContext });
        this.abortCurrentTranscription();
        this.abortController = new AbortController();

        // Store the transcription promise without awaiting it immediately
        const transcriptionPromise = this.transcribeFragment(fullContext);
        this.transcriptionPromises.push(transcriptionPromise);

        // Recursively add next fragment transcriptions to the promise array
        if (this.next) {
            logger.debug("Proceeding to transcribe next fragment", {
                nextFragment: this.next,
            });
            this.transcriptionPromises.push(this.next.transcribe(fullContext));
        }

        // Retry transcription with updated context concurrently
        this.retryTranscriptionWithContext();
    }

    private async transcribeFragment(fullContext: string) {
        try {
            logger.debug("Fetching audio buffer for transcription");
            const audioBuffer = await this.getAudioBuffer();
            logger.debug("Audio buffer obtained for transcription", {
                audioBufferLength: audioBuffer.length,
            });
            const audio = await toWav(audioBuffer);
            logger.debug("Converted AudioBuffer to WAV format", {
                wavLength: audio.length,
            });
            const transcription = await getTranscription(
                audio,
                fullContext,
                this.abortController?.signal,
            );
            logger.info("Received transcription", { transcription });
            this.handleNewTranscription(transcription);
        } catch (error) {
            logger.error("Error during transcription", { error });
            this.handleTranscriptionError(error);
        } finally {
            this.abortCurrentTranscription();
        }
    }

    private retryTranscriptionWithContext() {
        logger.info("Retrying transcription with updated context");

        let currentFragment: Fragment | undefined = this;
        while (currentFragment) {
            const retryPromise = currentFragment.transcribe(
                this.getBestTranscriptionText(),
            );
            this.transcriptionPromises.push(retryPromise);
            currentFragment = currentFragment.getNext();
        }
    }

    /**
     * Await all stored transcription promises
     */
    async awaitAllTranscriptions() {
        logger.info("Awaiting all transcription promises");
        await Promise.all(this.transcriptionPromises);
        logger.info("All transcriptions completed");
    }

    private abortCurrentTranscription() {
        if (this.abortController) {
            logger.warn("Aborting current transcription");
            this.abortController.abort();
            this.abortController = undefined;
        }
    }

    private findSegmentById(id: number): TranscribedSegment {
        logger.info("Finding segment by ID: %d", id);
        if (!this.transcription) {
            throw new Error("Untranscribed");
        }
        const segment = this.transcription.segments.find((s) => s.id === id);
        if (!segment) {
            logger.error("Segment with ID %d not found", id);
            throw new RangeError(`Segment with ID ${id} not found`);
        }
        return segment;
    }

    private handleNewTranscription(transcription: Transcription) {
        logger.info("Handling new transcription", { transcription });

        if (!transcription.text.trim()) {
            logger.warn(
                "Empty transcription received, marking fragment as untranscribable",
            );
            this.untranscribable = true;
            return;
        }

        // Add the new transcription to the list of candidate transcriptions
        this.candidateTranscriptions.push(transcription);
        logger.debug("Added new transcription to candidates", {
            candidateCount: this.candidateTranscriptions.length,
        });

        // Evaluate which transcription is the best based on metrics like avg_logprob
        this.bestTranscriptionIndex = this.evaluateBestTranscription();
        logger.info("Best transcription index updated", {
            bestTranscriptionIndex: this.bestTranscriptionIndex,
        });

        if (this.callbacks.onNewPrediction) {
            logger.debug(
                "Calling onNewPrediction callback with best transcription",
                { bestTranscription: this.getBestTranscription() },
            );
            this.callbacks.onNewPrediction(this.getBestTranscription());
        }
    }

    private evaluateBestTranscription(): number {
        let bestIndex = 0;
        let bestScore = Number.NEGATIVE_INFINITY;

        this.candidateTranscriptions.forEach((transcription, index) => {
            // Example heuristic: prioritize higher avg_logprob and lower no_speech_prob
            const avgLogprobScore = transcription.segments.reduce(
                (acc, segment) => acc + segment.avg_logprob,
                0,
            ) / transcription.segments.length;

            logger.debug("Evaluating transcription", {
                index,
                avgLogprobScore,
            });

            if (avgLogprobScore > bestScore) {
                bestScore = avgLogprobScore;
                bestIndex = index;
            }
        });

        logger.debug("Evaluated best transcription", { bestIndex, bestScore });
        return bestIndex;
    }

    private getBestTranscription(): Transcription {
        logger.debug("Getting best transcription", {
            bestTranscriptionIndex: this.bestTranscriptionIndex,
        });
        return this.candidateTranscriptions[this.bestTranscriptionIndex];
    }

    private getBestTranscriptionText(): string {
        return this.getBestTranscription().text;
    }

    private handleTranscriptionError(error: any) {
        if (error.name === "AbortError") {
            logger.warn("Transcription aborted");
        } else {
            logger.error("Transcription error", { error });
            if (this.callbacks.onError) {
                logger.debug("Calling onError callback with error", { error });
                this.callbacks.onError(error);
            }
        }
    }

    contract() {
        this.writeOut();
        return this.absorbNextFragment();
    }

    private async absorbNextFragment() {
        if (this.next) {
            logger.debug("Accumulating small fragment with the next one", {
                currentFragment: this,
                nextFragment: this.next,
            });
            this.buffer = await join(
                this.buffer,
                await this.next.getAudioBuffer(),
            );
            this.next = this.next.getNext();
            logger.info("Fragment accumulated with the next one", {
                newBufferDuration: this.buffer.duration,
            });
        }
    }

    // Add the visualizeChain() method
    visualizeChain(): string {
        let currentFragment: Fragment | undefined = undefined;
        currentFragment = this;
        let visualization = "Transcript Chain:\n";

        while (currentFragment) {
            const transcriptionText = currentFragment.transcription?.text ??
                "Pending";
            visualization +=
                `+-- Fragment @ ${currentFragment.timestamp.toISOString()} : ${transcriptionText}\n`;
            currentFragment = currentFragment.getNext();
        }

        return visualization;
    }
}
