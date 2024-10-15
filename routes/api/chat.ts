import { Handlers } from "$fresh/server.ts";
import { base64ToArrayBuffer } from "../../lib/buffer_transformations.ts";

interface ClientSession {
    abortController: AbortController;
    segments: ArrayBuffer[];
    isRecording: boolean;
    lastActivity: number;
    fullTranscription?: string;
    latestSegmentEmitted?: number;
}

const sessions = new Map<WebSocket, ClientSession>();

export const handler: Handlers = {
    async GET(req, _ctx) {
        const { socket, response } = Deno.upgradeWebSocket(req);
        setupWebSocketHandlers(socket);
        return response;
    },
};

// Set up WebSocket event handlers to manage the lifecycle of a client session
function setupWebSocketHandlers(socket: WebSocket) {
    socket.onopen = () => handleWebSocketOpen(socket);
    socket.onmessage = (event) => handleWebSocketMessage(socket, event.data);
    socket.onclose = (event) => handleWebSocketClose(socket, event);
    socket.onerror = (err) => handleWebSocketError(socket, err);
}

function handleWebSocketOpen(socket: WebSocket) {
    console.log("WebSocket connection opened");
    // Initialize a session for the client
    sessions.set(socket, createClientSession());
}

function createClientSession(): ClientSession {
    return {
        segments: [],
        isRecording: false,
        lastActivity: Date.now(),
        abortController: new AbortController(),
    };
}

function handleWebSocketMessage(socket: WebSocket, message: string) {
    const session = sessions.get(socket);
    if (!session) return;

    try {
        const controlMessage = JSON.parse(message);
        if (!isValidControlMessage(controlMessage)) {
            console.log("Invalid control message:", message);
            return;
        }
        handleControlMessage(socket, session, controlMessage);
    } catch (error) {
        console.error("Error processing control message:", error);
        sendErrorMessage(socket, "Error processing control message");
    }
}

function handleWebSocketClose(socket: WebSocket, event: CloseEvent) {
    console.log("WebSocket connection closed", event.code, event.reason);
    // Clean up the session
    sessions.delete(socket);
}

function handleWebSocketError(socket: WebSocket, err: Event | Error) {
    console.error("WebSocket error:", err);
    sessions.delete(socket);
}

export interface ControlMessage {
    type: "VAD_START" | "VAD_STOP" | "UTTERANCE" | "SEGMENT";
    data?: string;
}

function isValidControlMessage(message: unknown): message is ControlMessage {
    return (
        message &&
        typeof message === "object" &&
        "type" in message &&
        typeof (message as any).type === "string"
    );
}

// Handles control messages received from the client
function handleControlMessage(
    socket: WebSocket,
    session: ClientSession,
    controlMessage: ControlMessage,
) {
    switch (controlMessage.type) {
        case "VAD_START":
            startVAD(session);
            break;
        case "VAD_STOP":
            stopVAD(session);
            break;
        case "SEGMENT":
            processControlSegment(socket, session, controlMessage);
            break;
        case "UTTERANCE":
            processControlUtterance(socket, session, controlMessage);
            break;
        default:
            console.log("Unknown control message type:", controlMessage.type);
    }
}

function startVAD(session: ClientSession) {
    session.isRecording = true;
    session.segments = [];
    console.log("VAD_START received");
}

function stopVAD(session: ClientSession) {
    session.isRecording = false;
    session.segments = [];
    console.log("VAD_STOP received");
}

function processControlSegment(
    socket: WebSocket,
    session: ClientSession,
    controlMessage: ControlMessage,
) {
    console.log("Received a segment");
    if (!controlMessage.data) {
        console.log("No data in segment message");
        return;
    }

    // Save the segment data
    const data = base64ToArrayBuffer(controlMessage.data);
    session.segments.push(data);
    console.log("Received a segment");
    const segmentId = session.segments.length;

    // Abort the previous transcription process if it exists
    abortPreviousTranscription(session);

    // Start processing the new segment
    processAudio(socket, session, segmentId, session.segments, true);
}

function processControlUtterance(
    socket: WebSocket,
    session: ClientSession,
    controlMessage: ControlMessage,
) {
    console.log("Received an utterance");
    if (!controlMessage.data) {
        console.log("No data in utterance message");
        return;
    }

    // Clear the segments
    session.segments = [];
    const data = base64ToArrayBuffer(controlMessage.data);

    // Abort the previous transcription process if it exists
    abortPreviousTranscription(session);

    // Start processing the utterance
    processAudio(socket, session, 0, [data], false);
}

function abortPreviousTranscription(session: ClientSession) {
    if (session.abortController) {
        session.abortController.abort();
    }
    session.abortController = new AbortController();
}

async function processAudio(
    socket: WebSocket,
    session: ClientSession,
    segmentId: number,
    segments: ArrayBuffer[],
    isPartial: boolean,
) {
    const { signal } = session.abortController;
    try {
        const wavData = await Promise.all(
            segments.map((segment) => convertWebmToWav(segment)),
        );

        if (signal.aborted) {
            console.log("Processing aborted for segment:", segmentId);
            return;
        }

        const head = wavData.shift();
        if (!head) return;
        const tail = wavData.map(stripWavHeader);
        const wav = new Blob([head, ...tail], { type: "audio/wav" });
        const wavBytes = new Uint8Array(await wav.arrayBuffer());
        const transcription = await getWhisperTranscription(
            wavBytes,
            session.fullTranscription ?? "",
        );

        if (signal.aborted) {
            console.log("Transcription aborted for segment:", segmentId);
            return;
        }

        if (transcription) {
            if (isPartial) {
                sendPartialTranscription(
                    socket,
                    session,
                    transcription,
                    segmentId,
                );
            } else {
                session.fullTranscription = `${
                    session.fullTranscription ?? ""
                } ${transcription}`.trim();
                sendTranscription(socket, transcription);
            }
        }
    } catch (error) {
        handleProcessingError(
            socket,
            error,
            isPartial ? "segment" : "utterance",
        );
    }
}

function sendPartialTranscription(
    socket: WebSocket,
    session: ClientSession,
    transcription: string,
    segmentId: number,
) {
    if ((session.latestSegmentEmitted ?? 0) > segmentId) {
        console.warn("Unnecessary transcription:", transcription);
        return;
    }
    const reply = {
        type: "PARTIAL_TRANSCRIPTION",
        data: transcription,
        basedOn: segmentId,
    };
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(reply));
    } else {
        console.warn("Attempted to send message on a closed WebSocket:", reply);
    }
    session.latestSegmentEmitted = segmentId;
}

function sendTranscription(socket: WebSocket, transcription: string) {
    const reply = {
        type: "TRANSCRIPTION",
        data: transcription,
    };
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(reply));
    } else {
        console.warn("Attempted to send message on a closed WebSocket:", reply);
    }
}

function sendErrorMessage(socket: WebSocket, errorMessage: string) {
    const error = {
        type: "ERROR",
        data: errorMessage,
    };
    if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(reply));
    } else {
        console.warn("Attempted to send message on a closed WebSocket:", reply);
    }
}

function handleProcessingError(
    socket: WebSocket,
    error: any,
    context: "segment" | "utterance",
) {
    if (
        error instanceof DOMException && error.name === "InvalidStateError" &&
        socket.readyState !== WebSocket.OPEN
    ) {
        console.warn(
            "WebSocket is not open, cannot send error message for:",
            context,
        );
        return;
    }
    if (error.name === "AbortError") {
        console.log("Promise cancelled:", error.message);
        return;
    }

    console.error(`Error processing ${context}:`, error);
    sendErrorMessage(socket, `Error processing ${context}`);
}

export async function getWhisperTranscription(
    webmData: Uint8Array,
    initialPrompt: string = "",
): Promise<string> {
    const whisperUrl = new URL(
        (Deno.env.get("WHISPER_HOST") ?? "http://localhost:9000") + "/asr",
    );
    whisperUrl.searchParams.append("language", "en");
    whisperUrl.searchParams.append("initial_prompt", initialPrompt);
    const wavFile = new File([webmData], "audio.wav");

    const body = new FormData();
    body.append("audio_file", wavFile);

    const whisperResponse = await fetch(whisperUrl.toString(), {
        method: "POST",
        body: body,
    });

    if (!whisperResponse.ok) {
        throw new Error(
            `Error transcribing audio: ${whisperResponse.statusText}`,
        );
    }

    const transcription = await whisperResponse.text();
    return transcription.trim();
}

async function convertWebmToWav(webmData: ArrayBuffer): Promise<Uint8Array> {
    const command = new Deno.Command("ffmpeg", {
        args: [
            "-i",
            "pipe:0",
            "-f",
            "wav",
            "pipe:1",
        ],
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
    });

    const process = command.spawn();
    const writer = process.stdin.getWriter();
    const data = new Uint8Array(webmData);
    await writer.write(data);
    await writer.close();

    const output = await process.output();

    if (!output.success) {
        const errorMessage = new TextDecoder().decode(output.stderr);
        throw new Error(`Failed to convert WebM to WAV: ${errorMessage}`);
    }

    return output.stdout;
}

function stripWavHeader(wavData: Uint8Array): Uint8Array {
    return wavData.slice(44);
}
