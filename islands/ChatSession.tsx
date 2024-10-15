import SpeechInput, { type SegmentMessage } from "./audio/SpeechInput.tsx";
import { initializeWebSocket, ws } from "./ws/signals.ts";
import { useEffect, useState } from "preact/hooks";
import { useSignal } from "@preact/signals";

export default function ChatSession() {
    const [connectionStatus, setConnectionStatus] = useState("Connecting...");
    const [socketInfo, setSocketInfo] = useState({
        url: "",
        readyState: 0,
        protocols: "",
    });

    const pretranscription = useSignal("");
    const transcription = useSignal("");

    let lastTranscriptionBasedOn = 0;

    // Initialize the WebSocket connection
    useEffect(() => {
        initializeWebSocket();

        // When ws signal changes, update the status and info
        if (ws.value) {
            // Set the WebSocket info when it opens
            ws.value.onopen = () => {
                setConnectionStatus("Connected");
                setSocketInfo({
                    url: ws.value?.url ?? "",
                    readyState: ws.value?.readyState ?? 0,
                    protocols: ws.value?.protocol ?? "",
                });
            };

            // Set an error handler
            ws.value.onerror = (error) => {
                setConnectionStatus("Error");
                console.error("WebSocket error:", error);
            };

            // Handle WebSocket closure
            ws.value.onclose = (event) => {
                setConnectionStatus("Disconnected");
                console.log("WebSocket closed:", event);
            };

            // Log data if any messages are received
            ws.value.onmessage = (mensaje) => {
                console.log("WebSocket message received:", mensaje.data);
                try {
                    const message = JSON.parse(mensaje.data);
                    if (
                        !message || typeof message !== "object" ||
                        !("type" in message)
                    ) {
                        console.error("Invalid WebSocket message:", message);
                        return;
                    }

                    if (message.type === "TRANSCRIPTION") {
                        transcription.value = `${
                            transcription ?? ""
                        } ${message.data}`
                            .trim();
                        // Reset the last transcription for the next transaction
                        lastTranscriptionBasedOn = 0;
                        pretranscription.value = "";
                    } else {
                        console.log("Received message:", message);
                        const basedOn = message.basedOn ?? 0;
                        if (basedOn > lastTranscriptionBasedOn) {
                            pretranscription.value = message.data;
                            lastTranscriptionBasedOn = basedOn;
                        } else {
                            console.log(
                                "Ignoring message based on old transcription:",
                                message,
                            );
                        }
                    }
                } catch (error) {
                    console.error("Error parsing WebSocket message:", {
                        error,
                        data: mensaje.data,
                    });
                }
            };
        }
    }, []);

    if (!ws.value) {
        return (
            <div>
                <p>{connectionStatus}</p>
            </div>
        );
    }

    const handleSegment = (message: SegmentMessage) => {
        if (!ws.value) return;
        ws.value.send(JSON.stringify(message));
    };

    return (
        <div>
            <details>
                <summary>{connectionStatus}</summary>
                <ul>
                    <li>
                        <strong>WebSocket URL:</strong> {socketInfo.url}
                    </li>
                    <li>
                        <strong>Ready State:</strong>{" "}
                        {socketInfo.readyState === 1 ? "Open" : "Closed"}
                    </li>
                    <li>
                        <strong>Protocol:</strong>{" "}
                        {socketInfo.protocols || "None"}
                    </li>
                </ul>
            </details>
            <SpeechInput onSegment={handleSegment} />
            <p>
                {pretranscription.value}
            </p>
            <p>
                <strong>{transcription.value}</strong>
            </p>
        </div>
    );
}
