import SpeechInput from "./audio/SpeechInput.tsx";
import { initializeWebSocket, ws } from "./ws/signals.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import { IS_BROWSER } from "$fresh/runtime.ts";
import { type FragmentMessage } from "../lib/socket_messages.ts";
import { ServerConnection } from "../lib/ServerConnection.ts";
import { pino } from "npm:pino";

const logger = pino({ level: "info" });

export default function ChatSession() {
    const [connectionStatus, setConnectionStatus] = useState("Connecting...");
    const [socketInfo, setSocketInfo] = useState({
        url: "",
        readyState: 0,
        protocols: "",
    });
    const [transcription, setTranscription] = useState("");

    if (IS_BROWSER) {
        initializeWebSocket();
    }

    let server: ServerConnection | null = null;
    const serverRef = useRef<ServerConnection | null>(server);

    useEffect(() => {
    }, []);

    useEffect(() => {
        if (ws.value) {
            server = new ServerConnection(
                ws.value,
                setSocketInfo,
                setConnectionStatus,
                setTranscription,
            );
            serverRef.current = server;
        } else {
            if (server) {
                server?.hangup();
            }
        }
    }, [ws.value]);

    const handleFragment = (message: FragmentMessage) => {
        logger.info(message, "Received fragment");
        if (!serverRef.current) {
            logger.error("No server connection");
            return;
        }
        serverRef.current?.send(message);
    };

    return (
        <div>
            <details open={true}>
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
            <SpeechInput onFragment={handleFragment} />
            <div className="transcription-container">
                <h3>Live Transcription</h3>
                <p className="transcription">{transcription}</p>
            </div>
        </div>
    );
}
