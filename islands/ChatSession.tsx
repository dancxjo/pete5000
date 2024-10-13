import SpeechInput from "./audio/SpeechInput.tsx";
import { initializeWebSocket, ws } from "./ws/signals.ts";
import { useEffect, useState } from "preact/hooks";

export default function ChatSession() {
    const [connectionStatus, setConnectionStatus] = useState("Connecting...");
    const [socketInfo, setSocketInfo] = useState({
        url: "",
        readyState: 0,
        protocols: "",
    });

    // This is the main entry point for initializing the WebSocket connection
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
            ws.value.onmessage = (message) => {
                console.log("WebSocket message received:", message.data);
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
            <SpeechInput ws={ws} />
        </div>
    );
}
