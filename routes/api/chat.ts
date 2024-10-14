import { Handlers } from "$fresh/server.ts";
import { base64ToArrayBuffer } from "../../lib/buffer_transformations.ts";

interface ClientSession {
    segments: Blob[];
    isRecording: boolean;
    lastActivity: number;
}

const sessions = new Map<WebSocket, ClientSession>();

export const handler: Handlers = {
    async GET(req, _ctx) {
        const { socket, response } = Deno.upgradeWebSocket(req);

        socket.onopen = () => {
            console.log("WebSocket connection opened");
            // Initialize a session for the client
            sessions.set(socket, {
                segments: [],
                isRecording: false,
                lastActivity: Date.now(),
            });
        };

        socket.onmessage = async (event) => {
            return handleControlMessage(socket, event.data);
        };

        socket.onclose = (event) => {
            console.log(
                "WebSocket connection closed",
                event.code,
                event.reason,
            );
            // Clean up the session
            sessions.delete(socket);
        };

        socket.onerror = (err) => {
            console.error("WebSocket error:", err);
            sessions.delete(socket);
        };

        return response;
    },
};

export interface ControlMessage {
    type: "VAD_START" | "VAD_STOP" | "UTTERANCE" | "SEGMENT";
    data?: string;
}

function isValidControlMessage(message: unknown): message is ControlMessage {
    if (
        !message || typeof message !== "object" ||
        !("type" in message) || typeof message.type !== "string"
    ) {
        return false;
    }
    return true;
}

// Function to handle control messages (e.g., VAD state)
function handleControlMessage(socket: WebSocket, message: string) {
    const session = sessions.get(socket);
    if (!session) return;

    try {
        const controlMessage = JSON.parse(message);
        if (!isValidControlMessage(controlMessage)) {
            console.log("Invalid control message:", message);
            return;
        }

        switch (controlMessage.type) {
            case "VAD_START":
                session.isRecording = true;
                session.segments = [];
                console.log("VAD_START received");
                break;
            case "VAD_STOP":
                session.isRecording = false;
                console.log("VAD_STOP received");
                session.segments = [];
                break;
            case "UTTERANCE": {
                console.log("Received an utterance");
                if (!controlMessage.data) {
                    console.log("No data in utterance message");
                    return;
                }
                console.log({ controlMessage });
                const data = base64ToArrayBuffer(controlMessage.data);
                getWhisperTranscription(new Uint8Array(data)).then(
                    (transcription) => {
                        socket.send(
                            `{ "transcription": "${transcription}", "final": true }`,
                        );
                    },
                ).catch((error) => {
                    console.error("Error processing utterance:", error);
                    socket.send('{"error": "Error processing utterance"}');
                });
                break;
            }
            default:
                console.log("Unknown control message:", controlMessage.type);
        }
    } catch (error) {
        console.error("Error processing utterance:", error);
        socket.send("Error processing utterance");
    }
}

let counter = Date.now().valueOf();

// Adjusted getWhisperTranscription to accept a file path
export async function getWhisperTranscription(
    webmData: Uint8Array,
): Promise<string> {
    const whisperUrl = new URL(
        (Deno.env.get("WHISPER_HOST") ?? "http://localhost:9000") + "/asr",
    );
    // Fill in the other parameters as needed
    whisperUrl.searchParams.append("language", "en"); // Adjust parameter name as needed

    // const wavData = await convertWebmToWav(webmData);
    // Deno.writeFileSync(`audio${counter++}.webm`, webmData);
    // Read the WAV file
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
    return transcription;
}

async function convertWebmToWav(webmData: Uint8Array): Promise<Uint8Array> {
    // Use FFmpeg with stdin and stdout to handle in-memory data
    const command = new Deno.Command("ffmpeg", {
        args: [
            "-i",
            "pipe:0", // Read input from stdin
            "-f",
            "wav", // Force output format to WAV
            "pipe:1", // Write output to stdout
        ],
        stdin: "piped", // Provide stdin from memory
        stdout: "piped", // Capture stdout to memory
        stderr: "piped", // Capture stderr for error handling
    });

    // Start the ffmpeg process
    const process = command.spawn();

    // Write WebM data to ffmpeg's stdin
    const writer = process.stdin.getWriter();
    await writer.write(webmData);
    await writer.close();

    // Capture ffmpeg's stdout (the WAV data)
    const output = await process.output();

    // Check for errors
    if (!output.success) {
        const errorMessage = new TextDecoder().decode(output.stderr);
        throw new Error(`Failed to convert WebM to WAV: ${errorMessage}`);
    }

    // Return the resulting WAV data
    return output.stdout;
}
