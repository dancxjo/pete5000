import SpeechInput from "./audio/SpeechInput.tsx";
import { initializeWebSocket, ws } from "./ws/signals.ts";
import { useEffect, useState } from "preact/hooks";
import { IS_BROWSER } from "$fresh/runtime.ts";
import {
    type FragmentMessage,
    isValidFragmentMessage,
    isValidSocketMessage,
    MessageType,
    type SocketMessage,
} from "../lib/sockets.ts";
import { pino } from "npm:pino";

const logger = pino({ level: "info" });

class Server {
    protected socketInfo = {
        url: "",
        readyState: 0,
        protocols: "",
    };
    constructor(
        protected ws: WebSocket,
        protected setSocketInfo = (_info: typeof this.socketInfo) => {},
        protected setConnectionStatus = (_status: string) => {},
        protected setTranscription = (_transcription: string) => {},
    ) {
        this.setupHandlers();
    }

    set status(status: string) {
        this.setConnectionStatus(status);
    }

    private setupHandlers() {
        this.ws.onopen = () => {
            this.status = "Connected";

            this.socketInfo = {
                url: this.ws.url ?? "",
                readyState: this.ws.readyState ?? 0,
                protocols: this.ws.protocol ?? "",
            };
        };
        this.ws.onerror = (error) => {
            this.status = "Error";
            logger.error({ error }, "WebSocket error");
        };
        this.ws.onclose = (event) => {
            this.status = "Disconnected";
            logger.info(event, "WebSocket closed");
        };
        this.ws.onmessage = (event) => {
            try {
                this.handleMessage(event.data);
            } catch (err) {
                logger.error(err, "Error parsing WebSocket message:");
            }
        };
    }

    private handleMessage(message: unknown) {
        if (!isValidSocketMessage(message)) {
            logger.error(message, "Invalid WebSocket message");
            return;
        }
        switch (message.type) {
            case MessageType.FRAGMENT: {
                if (!isValidFragmentMessage(message)) {
                    logger.error(message, "Invalid WebSocket fragment message");
                    return;
                }

                this.send(message);
                break;
            }
            case MessageType.ERROR: {
                logger.error(message, "WebSocket error message");
                break;
            }
            case MessageType.DEBUG: {
                logger.debug(message, "WebSocket debug message");
                break;
            }
            default: {
                logger.warn(
                    message.type,
                    "Unknown message type received from WebSocket",
                );
            }
        }
    }

    get isOpen(): boolean {
        logger.debug(this.ws.readyState, "WebSocket ready state:");
        return this.ws.readyState === WebSocket.OPEN;
    }

    hangup() {
        this.ws.close();
    }

    send(message: SocketMessage) {
        logger.debug({ message }, "Sending WebSocket message");
        if (!this.isOpen) {
            logger.error("WebSocket is not open");
            return;
        }
        this.ws.send(JSON.stringify(message));
    }
}

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

    let server: Server | null = null;

    useEffect(() => {
        if (ws.value) {
            server = new Server(
                ws.value,
                setSocketInfo,
                setConnectionStatus,
                setTranscription,
            );
        } else {
            if (server) {
                server?.hangup();
            }
        }
    }, [ws.value]);

    const handleFragment = (message: FragmentMessage) => {
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
            <SpeechInput onFragment={handleFragment} />
            <div className="transcription-container">
                <h3>Live Transcription</h3>
                <p className="transcription">{transcription}</p>
            </div>
        </div>
    );
}
