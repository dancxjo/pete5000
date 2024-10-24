import { Clip } from "./Clip.ts";
import {
    type FragmentMessage,
    isValidFragmentMessage,
    MessageHandler,
    MessageType,
    parse,
    type SocketMessage,
} from "./socket_messages.ts";
import { Observable, Subject } from "npm:rxjs";
import { filter } from "npm:rxjs/operators";
import { join } from "./audio_processing.ts";
import { AudioContext } from "npm:web-audio-api";
import { pino } from "npm:pino";

export const logger = pino({
    level: "debug",
});

type Duration = [number, number];

export class TranscriptionSession {
    protected messageHandlers = new Map<MessageType, MessageHandler[]>();

    private incomingMessages = new Subject<SocketMessage>();
    private startedAt: Date | null = null;
    readonly incomingFragmentMessages: Observable<FragmentMessage>;
    private recording: AudioBuffer;
    private clipSubject = new Subject<Clip>();
    readonly clips$: Observable<Clip> = this.clipSubject.asObservable();
    private guessSubject = new Subject<Clip>();
    readonly guesses$: Observable<Clip> = this.guessSubject
        .asObservable();
    private tailTimeout: number | null = null;
    private readonly TAIL_TIMEOUT_MS = 3000; // 3 seconds timeout to flush tail

    constructor(
        readonly ws: WebSocket,
    ) {
        logger.debug("Initializing TranscriptionSession");
        const context = new AudioContext();
        this.recording = context.createBuffer(1, 0, 16000);

        this.incomingFragmentMessages = this.filterIncomingMessagesByType<
            FragmentMessage
        >(isValidFragmentMessage);

        this.setupWebSocket();
        this.setupRecording();
        this.handleEvents();
        this.subscribeToClips();
    }

    protected setupWebSocket() {
        logger.debug("Setting up WebSocket");
        this.ws.onopen = () => {
            logger.info("WebSocket connection established");
        };
        this.ws.onerror = (error) => {
            logger.error("WebSocket error", error);
        };
        this.ws.onclose = () => {
            logger.warn("WebSocket connection closed");
        };
    }

    protected setupRecording() {
        logger.debug("Setting up recording");
        this.incomingFragmentMessages.subscribe(async (fragment) => {
            logger.debug("Received fragment, processing");
            if (!this.startedAt) {
                this.startedAt = new Date(fragment.recordedAt);
            }
            const clip = await Clip.fromEncodedWebm(
                fragment.data,
                new Date(fragment.recordedAt),
            );
            this.recording = join(this.recording, clip.asAudioBuffer);
            const totalSegments = Math.floor(this.recording.duration);
            const segmentLength = 1; // 1 second
            const durations = this.generateDurations(
                totalSegments,
                segmentLength,
            );

            logger.debug(
                `Generated ${durations.length} durations for processing`,
            );

            durations.forEach(([start, end]) => {
                logger.debug(`Creating new clip from ${start}s to ${end}s`);
                if (!this.startedAt) {
                    logger.error("No start time for clip");
                    return;
                }
                const newClip = new Clip(
                    this.recording,
                    new Date(this.startedAt?.getTime() + (start * 1000)),
                    start,
                    end,
                );
                this.clipSubject.next(newClip);
            });

            // Clear any existing tail timeout and set a new one
            if (this.tailTimeout) {
                clearTimeout(this.tailTimeout);
                logger.debug("Cleared existing tail timeout");
            }
            this.tailTimeout = setTimeout(
                () => this.flushTail(),
                this.TAIL_TIMEOUT_MS,
            );
            logger.debug("Set new tail timeout");
        });
    }

    protected generateDurations(
        totalSegments: number,
        segmentLength: number,
    ): Duration[] {
        const durations: Duration[] = [];

        for (let i = 0; i < totalSegments; i++) {
            let end = (i + 1) * segmentLength;
            for (
                const start = i * segmentLength;
                end <= totalSegments * segmentLength;
                end += segmentLength
            ) {
                durations.push([start, end]);
            }
        }

        return durations;
    }

    protected flushTail() {
        logger.debug("Flushing tail");
        if (this.recording.duration > 0) {
            const finalClip = new Clip(
                this.recording,
                new Date(this.startedAt?.getTime() || 0),
                0,
                this.recording.duration,
            );
            this.clipSubject.next(finalClip);
            logger.debug("Flushing tail for final transcription.");
        } else {
            logger.debug("No recording to flush");
        }
    }

    protected subscribeToClips() {
        logger.debug("Subscribing to clips");
        this.clips$.subscribe((clip) => {
            logger.debug("Transcribing clip");
            clip.transcribe();
            clip.clips$.subscribe((newClip) => this.guessSubject.next(newClip));
        });
    }

    protected handleEvents() {
        logger.debug("Handling WebSocket events");
        this.ws.onmessage = (event) => {
            logger.debug("WebSocket message received");
            const message = parse(event.data);
            this.incomingMessages.next(message);
            const handlers = this.messageHandlers.get(message.type);
            if (handlers) {
                logger.debug(`Handling message of type ${message.type}`);
                handlers.forEach((handler) => handler(message));
            }
        };
    }

    onMessage(type: MessageType, handler: MessageHandler) {
        logger.debug(`Registering handler for message type ${type}`);
        const handlers = this.messageHandlers.get(type) || [];
        handlers.push(handler);
        this.messageHandlers.set(type, handlers);
    }

    filterIncomingMessages(
        keep: (msg: SocketMessage) => boolean,
    ): Observable<SocketMessage> {
        return this.incomingMessages.pipe(filter(keep));
    }

    filterIncomingMessagesByType<M extends SocketMessage>(
        validator: (msg: SocketMessage) => msg is M,
    ): Observable<M> {
        return this.filterIncomingMessages(validator) as Observable<M>;
    }

    send(message: SocketMessage) {
        logger.debug("Sending message through WebSocket", message);
        this.ws.send(JSON.stringify(message));
    }
}
