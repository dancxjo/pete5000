import { decodeWebm, join, toWav } from "./audio_processing.ts";
import {
    decodeWebmString,
    type FragmentMessage,
    isValidFragmentMessage,
    MessageType,
    parse,
    type SocketMessage,
} from "./socket_messages.ts";
import { IS_BROWSER } from "$fresh/runtime.ts";
import { pino } from "npm:pino";
import { Message, Ollama } from "npm:ollama";
import {
    getTranscription,
    type TranscribedSegment,
    type Transcription,
} from "./whisper.ts";

export const logger = pino({
    level: "debug",
    browser: { asObject: IS_BROWSER ? true : undefined },
});

const ollama = new Ollama({
    host: Deno.env.get("OLLAMA_HOST") ?? "http://localhost:11434",
});

let counter = Date.now();

export class ClientConnection {
    protected audioBuffer: AudioBuffer | null = null;
    protected fragments: Map<Date, AudioBuffer> = new Map();
    protected messageStream: ReadableStream<SocketMessage> | null = null;
    protected messageStreamController:
        | ReadableStreamDefaultController<SocketMessage>
        | null = null;
    protected chatHistory: Message[] = [];
    protected transcriptions: {
        recordedAt: Date;
        transcript: Transcription;
    }[] = [];
    protected anchor: Date = new Date();

    protected transcribedSegments: Map<Date, TranscribedSegment[]> = new Map();

    protected bestGuess: string = "";

    // Generate VTT file listing all possible transcriptions for each segment
    generateVTT(): string {
        let vttContent = "WEBVTT\n\n";
        [...this.transcribedSegments.entries()].forEach(
            ([timestamp, segments]) => {
                const start = new Date(timestamp).toISOString().substr(11, 12)
                    .replace(".", ",");
                const end = new Date(
                    timestamp.getTime() +
                        (segments[0].end - segments[0].start) * 1000,
                ).toISOString().substr(11, 12).replace(".", ",");
                segments.forEach((segment, index) => {
                    vttContent += `${start} --> ${end}\n(${
                        index + 1
                    }) ${segment.text}\n\n`;
                });
            },
        );
        return vttContent;
    }

    constructor(protected socket: WebSocket) {
        logger.debug("Initializing ClientConnection");
        this.setupWebSocket();
        this.initializeMessageStream();
    }

    protected initializeMessageStream() {
        logger.debug("Initializing message stream");
        this.messageStream = new ReadableStream<SocketMessage>({
            start: (controller) => {
                logger.debug("Message stream start callback");
                this.messageStreamController = controller;
                logger.debug("Message stream controller set");
            },
            cancel: (reason) => {
                logger.info({ reason }, "Message stream canceled");
            },
        });
        const [a, b] = this.messageStream.tee();
        this.messageStream = a;
        logger.debug("Message stream split into two branches");

        const fragmentMessageFilter = new TransformStream<
            SocketMessage,
            FragmentMessage
        >({
            transform: (chunk, controller) => {
                logger.debug("Filtering fragment messages");
                if (isValidFragmentMessage(chunk)) {
                    logger.debug("Valid fragment message found");
                    controller.enqueue(chunk);
                } else {
                    logger.warn("Invalid fragment message discarded");
                }
            },
        });

        const fragmentTranscoder = new TransformStream<
            FragmentMessage,
            { recordedAt: Date; audioBuffer: AudioBuffer }
        >({
            transform: async (chunk, controller) => {
                logger.debug("Transcoding fragment message");
                const fragment = chunk as FragmentMessage;
                try {
                    if (new Date(chunk.recordedAt) < this.anchor) {
                        this.anchor = new Date(chunk.recordedAt);
                    }
                    const audioBuffer = await decodeWebm(
                        decodeWebmString(fragment.data),
                    );
                    logger.debug("Decoded audio buffer from fragment");
                    logger.debug(
                        {
                            audioBufferLength: audioBuffer.length,
                            recordedAt: fragment.recordedAt,
                        },
                        "Audio buffer length after decoding and recordedAt timestamp",
                    );
                    controller.enqueue({
                        recordedAt: new Date(fragment.recordedAt),
                        audioBuffer,
                    });
                } catch (err) {
                    logger.error(
                        { err, fragment },
                        "Failed to transcode fragment message",
                    );
                }
            },
        });

        // Transform stream to accumulate segments until they are ready to be transcribed
        const segmentAccumulator = new TransformStream<
            { recordedAt: Date; audioBuffer: AudioBuffer },
            AudioBuffer
        >({
            start: () => {
                logger.debug("Starting segment accumulation");
                this.audioBuffer = null;
            },
            transform: async (chunk, controller) => {
                const fragment = chunk as {
                    audioBuffer: AudioBuffer;
                    recordedAt: Date;
                };
                try {
                    this.audioBuffer = this.audioBuffer
                        ? await join(this.audioBuffer, fragment.audioBuffer)
                        : fragment.audioBuffer;

                    const deservesSnipping = (buffer: AudioBuffer): boolean => {
                        const length = buffer.length;
                        return length >= buffer.sampleRate * 10 ||
                            length <= buffer.sampleRate * 0.5;
                    };

                    const hasBeenConfidentlyDescribed = (
                        start: Date,
                        end: Date,
                    ): boolean => {
                        return this.transcriptions.some(
                            ({ recordedAt, transcript }) => {
                                const totalLength = transcript.segments.reduce(
                                    (acc, seg) => acc + seg.end - seg.start,
                                    0,
                                );
                                const endAt = new Date(
                                    recordedAt.getTime() + totalLength,
                                );
                                return recordedAt <= start && endAt >= end;
                            },
                        );
                    };

                    if (
                        deservesSnipping(this.audioBuffer) ||
                        hasBeenConfidentlyDescribed(
                            fragment.recordedAt,
                            new Date(),
                        )
                    ) {
                        logger.debug(
                            "Audio buffer ready for transcription, enqueuing",
                        );
                        controller.enqueue(this.audioBuffer);
                        if (
                            this.audioBuffer.length >
                                10 * this.audioBuffer.sampleRate
                        ) {
                            logger.warn(
                                "Audio buffer is too long, clearing",
                            );
                            this.audioBuffer = null;
                        }
                    }
                } catch (err) {
                    logger.error(
                        { err, fragment },
                        "Error during segment accumulation",
                    );
                }
            },
            flush: (controller) => {
                if (this.audioBuffer) {
                    logger.debug("Flushing final audio segment");
                    controller.enqueue(this.audioBuffer);
                }
            },
        });

        type LoadedVTT = string;
        const transcriber = new TransformStream<AudioBuffer, LoadedVTT>({
            start: (_controller) => {
                logger.debug("Starting transcriber");
            },
            transform: async (chunk, controller) => {
                logger.debug("Transcribing audio segment");
                const wav = await toWav(chunk);
                const proposedTranscription = await getTranscription(
                    wav,
                    this.bestGuess,
                );
                const segments = proposedTranscription.segments;
                segments.forEach((segment) => {
                    const when = new Date(
                        this.anchor.getTime() + segment.start,
                    );
                    this.transcribedSegments.set(
                        when,
                        this.transcribedSegments.get(when) ?? [],
                    );
                    this.transcribedSegments.get(when)?.push(segment);
                });

                controller.enqueue(this.generateVTT());
            },
            flush: (_controller) => {
                logger.debug("Finished transcribing audio segments");
            },
        });

        type RefinedChunk = string;
        const refiner = new TransformStream<LoadedVTT, RefinedChunk>({
            start: (_controller) => {
                logger.debug("Starting refiner");
                // Clear the last transcription
                // _controller.enqueue("\u0004");
            },
            transform: async (chunk, controller) => {
                logger.debug("Processing input through refiner");
                const prompt: Message[] = [
                    {
                        role: "system",
                        content:
                            "You are an expert transcriptionist tasked with synthesizing the final text from a series of conflicting transcriptions in VTT format. First, analyze the entire content to infer its purpose (e.g., a recipe, a resume, a screenplay, or a shopping list). Then, using context, eliminate incorrect transcriptions and reconstruct the most accurate text, correcting speech disfluencies. Add appropriate punctuation and capitalization to ensure readability, and format the text according to its style (not as a VTT file). Your response should only contain the corrected and formatted text, without repeating this prompt or adding commentary. If the content is unclear, return an empty fragment.",
                    },
                    // {
                    //     role: "user",
                    //     content: `Your last best guess was: ${this.bestGuess}`,
                    // },
                    { role: "user", content: chunk },
                ];
                logger.debug({ prompt }, "Prompt for refiner");
                const response = await ollama.chat({
                    messages: prompt,
                    model: Deno.env.get("OLLAMA_MODEL") ?? "llama3.2",
                    stream: false,
                });

                const proposed = response.message.content.replace("```", "");

                this.bestGuess = proposed.trim() ?? chunk;
                controller.enqueue(this.bestGuess);
            },
            flush: (_controller) => {
                logger.debug("Finished processing assistant response");
            },
        });

        logger.debug("Setting up pipeline for fragment processing");
        const transcodedFragments = b.pipeThrough(fragmentMessageFilter)
            .pipeThrough(fragmentTranscoder);

        const refinedTranscription = transcodedFragments
            .pipeThrough(segmentAccumulator)
            .pipeThrough(transcriber)
            .pipeThrough(refiner);

        refinedTranscription.pipeTo(
            new WritableStream({
                write: (chunk) => {
                    logger.debug("Writing refined chunk to output");
                    this.socket.send(JSON.stringify({
                        type: MessageType.PROPOSAL,
                        data: chunk,
                    }));
                },
                close: () => {
                    logger.info("Refined transcription pipeline closed");
                },
                abort: (err) => {
                    logger.error(
                        { err },
                        "Error in refined transcription pipeline",
                    );
                },
            }),
        )
            .catch((err) => {
                logger.error(
                    { err },
                    "Error in processing stream pipeline",
                );
            }).finally(() => {
                logger.info("Fragment processing pipeline completed");
            });
        logger.debug("Fragment processing pipeline set up");
    }

    protected enqueueMessageToStream(message: SocketMessage) {
        logger.debug("Attempting to enqueue message to stream");
        if (message.type !== MessageType.FRAGMENT) {
            logger.debug({ message }, "Message data being enqueued");
        }
        if (this.messageStreamController) {
            logger.debug("Message stream controller found, enqueuing message");
            this.messageStreamController.enqueue(message);
        } else {
            logger.error("Message stream controller is not initialized");
        }
    }

    get messages(): ReadableStream<SocketMessage> {
        logger.debug("Accessing message stream");
        if (!this.messageStream) {
            logger.error("Message stream not initialized");
            throw new Error("Message stream not initialized");
        }
        return this.messageStream;
    }

    protected setupWebSocket() {
        logger.debug("Setting up WebSocket");
        this.socket.onopen = () => {
            logger.info("WebSocket connection established");
        };
        this.socket.onclose = () => this.handleWebSocketClose();
        this.socket.onerror = (err) => this.handleWebSocketError(err);
        this.socket.onmessage = (event) => this.handleWebSocketMessage(event);
    }

    protected handleWebSocketClose() {
        logger.info("WebSocket connection closed");
    }

    protected handleWebSocketError(err: Event) {
        logger.error({ err }, "WebSocket error occurred");
    }

    protected handleWebSocketMessage(event: MessageEvent) {
        logger.debug("WebSocket message received");
        const message = parse(event.data);
        logger.debug("Parsed WebSocket message");
        this.enqueueMessageToStream(message);

        if (
            message.type === MessageType.FRAGMENT &&
            isValidFragmentMessage(message)
        ) {
            logger.debug("Enqueuing valid fragment message to stream");
        } else {
            logger.warn(
                { message },
                "Received invalid or unsupported message type",
            );
        }
    }

    async pushWebmFragment(
        webmData: Uint8Array,
        recordedAt: Date,
    ): Promise<void> {
        logger.debug("Pushing WebM fragment to conversation");
        logger.debug(
            { recordedAt, webmDataLength: webmData.length },
            "WebM fragment metadata",
        );
        try {
            const audioBuffer = await decodeWebm(webmData);
            logger.debug("Decoded WebM fragment to audio buffer");
            logger.debug(
                { audioBufferLength: audioBuffer.length },
                "Audio buffer length after decoding",
            );
            if (this.fragments.has(recordedAt)) {
                logger.warn(
                    { recordedAt },
                    "Fragment with same timestamp already exists",
                );
                return;
            }
            this.fragments.set(recordedAt, audioBuffer);
            logger.info({ recordedAt }, "Fragment pushed to conversation");
        } catch (err) {
            logger.error({ err, recordedAt }, "Failed to push WebM fragment");
        }
    }

    protected addFragmentToConversation(
        webmData: Uint8Array,
    ) {
        logger.debug("Adding fragment to conversation transcript");
        logger.debug(
            { webmDataLength: webmData.length },
            "WebM data length before pushing to conversation",
        );
        this.pushWebmFragment(webmData, new Date()).then(() => {
            logger.info("Fragment added to conversation");
        }).catch((err: Error | unknown) => {
            logger.error({ err }, "Failed to add fragment to conversation");
            const message = err instanceof Error
                ? err.message
                : JSON.stringify(err);
            this.sendErrorMessage(message);
        });
    }

    protected sendErrorMessage(message: string) {
        logger.warn({ message }, "Sending error message to client");
        this.socket.send(
            JSON.stringify({
                type: "ERROR",
                message,
            }),
        );
    }
}
