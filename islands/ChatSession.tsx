import SpeechInput, { type SegmentMessage } from "./audio/SpeechInput.tsx";
import { initializeWebSocket, ws } from "./ws/signals.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import { IS_BROWSER } from "$fresh/runtime.ts";

export default function ChatSession() {
    const [connectionStatus, setConnectionStatus] = useState("Connecting...");
    const [socketInfo, setSocketInfo] = useState({
        url: "",
        readyState: 0,
        protocols: "",
    });
    const [transcription, setTranscription] = useState("");
    const [mermaidTree, setMermaidTree] = useState("");
    const transcriptionRef = useRef("");
    const [diffs, setDiffs] = useState([]);

    if (IS_BROWSER) {
        initializeWebSocket();
    }

    let wasConnected = false;

    useEffect(() => {
        if (ws.value) {
            if (wasConnected) {
                return;
            }
            wasConnected = true;
            ws.value.onopen = () => {
                setConnectionStatus("Connected");
                setSocketInfo({
                    url: ws.value?.url ?? "",
                    readyState: ws.value?.readyState ?? 0,
                    protocols: ws.value?.protocol ?? "",
                });
            };
            ws.value.onerror = (error) => {
                setConnectionStatus("Error");
                console.error("WebSocket error:", error);
            };
            ws.value.onclose = (event) => {
                setConnectionStatus("Disconnected");
                console.log("WebSocket closed:", event);
            };
            ws.value.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    handleWebSocketMessage(message);
                } catch (err) {
                    console.error("Error parsing WebSocket message:", err);
                }
            };
        } else {
            wasConnected = false;
            setConnectionStatus("Disconnected");
        }
    }, []);

    const handleWebSocketMessage = (message) => {
        switch (message.type.toUpperCase()) {
            case "FINAL_TRANSCRIPTION":
                setTranscription(message.data);
                setDiffs([]); // Clear diffs when a final transcription is received
                break;
            case "TREE":
                setMermaidTree(message.data);
                break;
            case "PREDICTION_UPDATE":
                updateTranscriptionWithDiff(message.data);
                break;
            case "NEW_PREDICTION":
                setTranscription(message.data);
                break;
            case "ERROR":
                console.error("WebSocket error message:", message.data);
                break;
            default:
                console.warn(
                    "Unknown message type received from WebSocket:",
                    message.type,
                );
        }
    };

    const updateTranscriptionWithDiff = (diffData) => {
        setDiffs(diffData); // Store the diffs received from the server
        applyDiffsToTranscription(diffData);
    };

    const applyDiffsToTranscription = (diffData) => {
        let updatedTranscription = transcriptionRef.current;
        diffData.forEach((diff) => {
            if (diff.added) {
                updatedTranscription +=
                    `<span class='added diff-animation'>${diff.value}</span>`;
            } else if (diff.removed) {
                updatedTranscription = updatedTranscription.replace(
                    diff.value,
                    `<span class='removed diff-animation'>${diff.value}</span>`,
                );
            } else {
                updatedTranscription += diff.value;
            }
        });
        setTranscription(updatedTranscription);
        transcriptionRef.current = updatedTranscription;
    };

    const handleSegment = (message: SegmentMessage) => {
        if (!ws.value) return;
        ws.value.send(JSON.stringify(message));
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
            <SpeechInput onSegment={handleSegment} />
            <div className="transcription-container">
                <h3>Live Transcription</h3>
                <p className="transcription">{transcription}</p>
                <pre className="mermaid-tree">{mermaidTree}</pre>
            </div>
        </div>
    );
}
