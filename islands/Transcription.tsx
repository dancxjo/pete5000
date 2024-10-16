import { useEffect } from "preact/hooks";
import { useSignal } from "@preact/signals";
import { initializeWebSocket, ws } from "./ws/signals.ts";

export default function TranscriptionIsland() {
    const pretranscription = useSignal("");
    const transcription = useSignal("");
    const redactedPredictions = useSignal<string[]>([]);

    // Initialize the WebSocket connection
    useEffect(() => {
        initializeWebSocket();

        if (ws.value) {
            ws.value.onmessage = (messageEvent) => {
                const message = JSON.parse(messageEvent.data);
                if (message.type === "FINAL_TRANSCRIPTION") {
                    // Finalized part of the transcription
                    transcription.value =
                        `${transcription.value} ${message.data}`.trim();
                    // Clear the prediction and redacted predictions
                    pretranscription.value = "";
                    redactedPredictions.value = [];
                } else if (message.type === "PREDICTION_UPDATE") {
                    // Handle prediction updates
                    if (
                        pretranscription.value &&
                        pretranscription.value !== message.data
                    ) {
                        // Mark the previous prediction as redacted
                        redactedPredictions.value = [
                            ...redactedPredictions.value,
                            pretranscription.value,
                        ];
                        // Emit a redaction message to the server
                        if (ws.value) {
                            ws.value.send(
                                JSON.stringify({
                                    type: "REDACTION",
                                    data: pretranscription.value,
                                }),
                            );
                        }
                    }
                    // Update the current prediction
                    pretranscription.value = message.data;
                }
            };
        }
    }, []);

    return (
        <div>
            <p>
                {redactedPredictions.value.map((redacted, index) => (
                    <span key={index}>
                        <del>{redacted}</del> {" "}
                    </span>
                ))}
                <em style={{ color: "#888" }}>{pretranscription.value}</em>
            </p>
            <p>
                <strong>{transcription.value}</strong>
            </p>
        </div>
    );
}
