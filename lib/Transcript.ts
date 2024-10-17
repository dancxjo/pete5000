import { decodeWebm } from "./audio_processing.ts";
import { Fragment } from "./Fragment.ts";
import type { TranscriptCallbacks } from "./TranscriptCallbacks.ts";
import { pino } from "npm:pino";

const logger = pino({ level: "debug" });

/**
 * Manages a series of audio fragments for transcription, including pushing new fragments,
 * maintaining head, tail, and cursor pointers, and handling the transcription flow.
 */
export class Transcript {
    private head?: Fragment;
    private tail?: Fragment;
    private cursor?: Fragment;
    private backwardsBuffer: string = "";
    private readonly bufferLimit: number = 1000; // Limit the buffer to a specific number of characters

    constructor(private callbacks: TranscriptCallbacks = {}) {
        logger.info("Transcript instance created.", {
            bufferLimit: this.bufferLimit,
        });
    }

    contract() {
        this.head?.contract();
    }

    /**
     * Transcribes the entire conversation starting from the current cursor.
     * @returns The text of the transcription.
     */
    async transcribe(): Promise<string> {
        logger.debug("Transcribing the entire conversation.", {
            cursor: this.cursor,
        });
        this.cursor?.transcribe(this.backwardsBuffer);
        return new Promise((resolve) =>
            this.cursor?.awaitAllTranscriptions().then(() => {
                this.cursor?.writeOut();
                const transcription = this.cursor?.getTranscription();
                logger.debug("Transcription complete.", { transcription });
                resolve(transcription?.text ?? "");
            }).catch((error) => {
                logger.error("Error while transcribing conversation.", {
                    error,
                });
            }).finally(() => {
                logger.info("Transcription process completed.");
            })
        );
    }

    visualize() {
        return this.head?.visualizeChain();
    }

    /**
     * Pushes new WebM data as a fragment to the tail of the transcript.
     * @param webmData - The WebM data to decode and add as a new fragment.
     * @param timestamp - The timestamp for the new fragment.
     */
    async pushWebm(webmData: Uint8Array, timestamp: Date) {
        logger.debug("Attempting to push new WebM data.", { timestamp });
        const buffer = await decodeWebm(webmData);
        logger.debug("Decoded WebM to AudioBuffer.", { buffer });
        const fragment = new Fragment(
            buffer,
            timestamp,
            undefined,
            this.callbacks,
        );
        this.pushFragment(fragment);
    }

    /**
     * Pushes a new fragment to the tail of the transcript.
     * @param fragment - The fragment to be added.
     */
    pushFragment(fragment: Fragment) {
        logger.debug("Attempting to push new fragment.", { fragment });

        if (!this.head) {
            logger.info(
                "Setting head, tail, and cursor to the new fragment for the first time.",
                { fragment },
            );
            this.head = fragment;
            this.tail = fragment;
            this.cursor = fragment;
        } else if (this.tail) {
            logger.debug("Adding fragment to the tail.", {
                currentTail: this.tail,
            });
            try {
                this.tail.push(fragment);
                this.tail = fragment.tail;
                logger.info("Updated tail with new fragment.", {
                    newTail: this.tail,
                });
            } catch (error) {
                logger.error("Failed to add fragment to the tail.", { error });
            }
        }
    }

    /**
     * Gets the current context of the transcript.
     * @returns The current transcription context.
     */
    getCurrentContext(): string {
        logger.debug("Getting current context.", {
            backwardsBuffer: this.backwardsBuffer,
        });
        return this.backwardsBuffer;
    }

    /**
     * Moves the cursor to the next fragment in the chain if available.
     */
    moveCursorToNext() {
        logger.debug("Attempting to move cursor to the next fragment.", {
            currentCursor: this.cursor,
        });

        if (this.cursor && this.cursor.getNext()) {
            this.cursor = this.cursor.getNext();
            logger.info("Cursor successfully moved to the next fragment.", {
                newCursor: this.cursor,
            });
        } else {
            logger.warn("No next fragment found. Cursor remains unchanged.");
        }
    }

    /**
     * Handles when a fragment is marked as stable and updates the transcript accordingly.
     * @param stableFragment - The fragment that has become stable.
     */
    onStableFragment(stableFragment: Fragment) {
        logger.info("Stable fragment received.", { stableFragment });

        if (this.callbacks.onStableFragment) {
            logger.debug("Calling onStableFragment callback.");
            try {
                this.callbacks.onStableFragment(stableFragment);
            } catch (error) {
                logger.error("Error while calling onStableFragment callback.", {
                    error,
                });
            }
        }
        this.updateBackwardsBuffer(stableFragment);

        if (this.cursor === stableFragment) {
            logger.info("Cursor matches stable fragment, moving to next.");
            this.moveCursorToNext();
        }
    }

    /**
     * Updates the backwards buffer with the transcription of the given fragment.
     * @param fragment - The fragment to add to the backwards buffer.
     */
    private updateBackwardsBuffer(fragment: Fragment) {
        logger.debug("Updating backwards buffer.", { fragment });

        const transcription = fragment.getTranscription();
        if (transcription) {
            logger.info("Adding transcription to backwards buffer.", {
                transcription: transcription.text,
            });
            this.backwardsBuffer =
                (this.backwardsBuffer + " " + transcription.text).trim();

            if (this.backwardsBuffer.length > this.bufferLimit) {
                logger.warn("Backwards buffer exceeded limit, trimming.", {
                    bufferLength: this.backwardsBuffer.length,
                });
                this.backwardsBuffer = this.backwardsBuffer.slice(
                    -this.bufferLimit,
                );
            }
        } else {
            logger.warn("No transcription found for fragment.");
        }
    }
}
