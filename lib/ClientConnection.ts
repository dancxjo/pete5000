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
import { getTranscription } from "./whisper.ts";

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

        const fragmentMessageFilter = new TransformStream({
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

        const fragmentTranscoder = new TransformStream({
            transform: async (chunk, controller) => {
                logger.debug("Transcoding fragment message");
                const fragment = chunk as FragmentMessage;
                try {
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

        const segmentAccumulator = new TransformStream({
            start: (controller) => {
                logger.debug(
                    "Starting segment accumulation (silence detector)",
                );
                this.audioBuffer = null;
            },
            transform: async (chunk, controller) => {
                logger.debug("Detecting silence in audio segments");
                const fragment = chunk as {
                    audioBuffer: AudioBuffer;
                    recordedAt: Date;
                };
                logger.debug(
                    {
                        fragmentBufferLength: fragment.audioBuffer.length,
                        recordedAt: fragment.recordedAt,
                    },
                    "Fragment audio buffer length and recordedAt during silence detection",
                );
                try {
                    if (!this.audioBuffer) {
                        logger.debug("Setting initial audio buffer");
                        this.audioBuffer = fragment.audioBuffer;
                    } else {
                        logger.debug("Joining audio buffers");
                        const newBuffer = await join(
                            this.audioBuffer,
                            fragment.audioBuffer,
                        );
                        this.audioBuffer = newBuffer;
                        logger.debug(
                            { newBufferLength: newBuffer.length },
                            "New audio buffer length after joining",
                        );
                    }

                    // Implement silence detection logic
                    const silenceThreshold = 0.75; // Arbitrary threshold for silence detection
                    let isSilent = true;
                    for (let i = 0; i < this.audioBuffer.length; i++) {
                        if (
                            Math.abs(this.audioBuffer.getChannelData(0)[i]) >
                                silenceThreshold
                        ) {
                            isSilent = false;
                            break;
                        }
                    }

                    if (isSilent) {
                        logger.debug(
                            "Detected silence in audio buffer, enqueuing",
                        );
                        controller.enqueue(this.audioBuffer);
                        this.audioBuffer = null;
                    }
                } catch (err) {
                    logger.error(
                        { err, fragment },
                        "Error during silence detection",
                    );
                }
            },
            flush: (controller) => {
                logger.debug("Flushing accumulated audio segments");
                if (this.audioBuffer) {
                    logger.debug(
                        { finalBufferLength: this.audioBuffer.length },
                        "Final audio buffer length before flush",
                    );
                    controller.enqueue(this.audioBuffer);
                }
            },
        });

        // TODO: Feed back the segments identified by whisper
        const segmentAccumulator1 = new TransformStream({
            start: (controller) => {
                logger.debug("Starting segment accumulation");
                this.audioBuffer = null;
            },
            transform: async (chunk, controller) => {
                logger.debug("Accumulating audio segments");
                const fragment = chunk as {
                    audioBuffer: AudioBuffer;
                    recordedAt: Date;
                };
                logger.debug(
                    {
                        fragmentBufferLength: fragment.audioBuffer.length,
                        recordedAt: fragment.recordedAt,
                    },
                    "Fragment audio buffer length and recordedAt during accumulation",
                );
                try {
                    if (!this.audioBuffer) {
                        logger.debug("Setting initial audio buffer");
                        this.audioBuffer = fragment.audioBuffer;
                    } else {
                        logger.debug("Joining audio buffers");
                        const newBuffer = await join(
                            this.audioBuffer,
                            fragment.audioBuffer,
                        );
                        this.audioBuffer = newBuffer;
                        logger.debug(
                            { newBufferLength: newBuffer.length },
                            "New audio buffer length after joining",
                        );
                    }
                    const longEnough = 3 * this.audioBuffer.sampleRate;
                    logger.debug({
                        currentBufferLength: this.audioBuffer.length,
                        longEnoughThreshold: longEnough,
                    }, "Checking if audio buffer is long enough to enqueue");
                    if (this.audioBuffer.length > longEnough) {
                        logger.debug("Audio buffer long enough, enqueuing");
                        controller.enqueue(this.audioBuffer);
                        this.audioBuffer = null;
                    }
                } catch (err) {
                    logger.error(
                        { err, fragment },
                        "Error during segment accumulation",
                    );
                }
            },
            flush: (controller) => {
                logger.debug("Flushing accumulated audio segments");
                if (this.audioBuffer) {
                    logger.debug(
                        { finalBufferLength: this.audioBuffer.length },
                        "Final audio buffer length before flush",
                    );
                    controller.enqueue(this.audioBuffer);
                }
            },
        });

        const transcriber = new TransformStream({
            start: (_controller) => {
                logger.debug("Starting transcriber");
            },
            transform: async (chunk, controller) => {
                logger.debug("Transcribing audio segment");
                const wav = await toWav(chunk);
                // TODO: Feed back in the overall summary as the second parameter
                const proposedTranscription = await getTranscription(wav);
                const _segments = proposedTranscription.segments;
                // TODO: Feed back the segments identified by whisper
                const transcribedText = proposedTranscription.text;
                controller.enqueue(transcribedText);
            },
            flush: (_controller) => {
                logger.debug("Finished transcribing audio segments");
            },
        });

        const assistant = new TransformStream({
            start: (_controller) => {
                logger.debug("Starting assistant");
            },
            transform: async (chunk, controller) => {
                logger.debug("Processing input through assistant");
                this.chatHistory.push({
                    role: "user",
                    content: chunk,
                });
                const prompt: Message[] = [
                    {
                        role: "system",
                        content:
                            "You are a helpful assistant, an ensemble of AI tools working together, not just a large language model. This is a conversation you are having on your web interface. The user is experiencing this conversation in real time with text to speech and speech to text.",
                    },
                    ...this.chatHistory,
                ];
                const stream = await ollama.chat({
                    messages: prompt,
                    model: Deno.env.get("OLLAMA_MODEL") ?? "llama3.2",
                    stream: true,
                });
                for await (const chunk of stream) {
                    controller.enqueue(chunk.message.content);
                }
            },
            flush: (_controller) => {
                logger.debug("Finished processing assistant response");
            },
        });

        const sentenceParser = new TransformStream({
            start: (controller) => {
                logger.debug("Starting sentence parser");
            },
            transform: (chunk, controller) => {
                logger.debug("Parsing assistant response into sentences");
                // Placeholder logic for sentence parsing
                const sentences = chunk.split(".").map((sentence) =>
                    sentence.trim() + "."
                );
                sentences.forEach((sentence) => controller.enqueue(sentence));
            },
            flush: (controller) => {
                logger.debug("Finished parsing sentences");
            },
        });

        const responseFormatter = new TransformStream({
            start: (controller) => {
                logger.debug("Starting response formatter");
            },
            transform: (chunk, controller) => {
                logger.debug("Formatting response for readability");
                // Placeholder logic for response formatting
                const formattedResponse = `[Formatted response: ${chunk}]`;
                controller.enqueue(formattedResponse);
            },
            flush: (controller) => {
                logger.debug("Finished formatting response");
            },
        });

        const ttsSystem = new TransformStream({
            start: (controller) => {
                logger.debug("Starting TTS system");
            },
            transform: async (chunk, controller) => {
                logger.debug("Converting response to speech");
                // Placeholder logic for TTS conversion
                const ttsAudio = `[TTS audio data for: ${chunk}]`;
                controller.enqueue(ttsAudio);
            },
            flush: (controller) => {
                logger.debug("Finished TTS conversion");
            },
        });

        const sendToSocket = new WritableStream({
            start: () => {
                logger.debug("Starting send to socket");
            },
            write: (chunk) => {
                logger.debug("Sending TTS audio data over WebSocket");
                try {
                    const mp3Audio = `[MP3 audio data for: ${chunk}]`; // Placeholder for MP3 audio data
                    this.socket.send(mp3Audio);
                    logger.info("MP3 audio data sent successfully");
                } catch (err) {
                    logger.error(
                        { err, chunk },
                        "Failed to send TTS audio data over WebSocket",
                    );
                }
            },
            close: () => {
                logger.info(
                    "Finished sending all TTS audio data over WebSocket",
                );
            },
        });

        logger.debug("Setting up pipeline for fragment processing");
        b.pipeThrough(fragmentMessageFilter)
            .pipeThrough(fragmentTranscoder)
            .pipeThrough(segmentAccumulator)
            .pipeThrough(transcriber)
            .pipeTo(
                new WritableStream({
                    write: (chunk) => {
                        logger.debug({ chunk }, "Transcribed chunk");
                        this.socket.send(
                            JSON.stringify({
                                type: MessageType.PROPOSAL,
                                data: chunk,
                            }),
                        );
                    },
                }),
            )
            // .pipeThrough(assistant)
            // .pipeThrough(sentenceParser)
            // .pipeThrough(responseFormatter)
            // .pipeThrough(ttsSystem)
            // .pipeTo(sendToSocket)
            .catch((err) => {
                logger.error({ err }, "Error in processing stream pipeline");
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
