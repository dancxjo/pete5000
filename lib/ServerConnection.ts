import {
    isValidFragmentMessage,
    isValidSocketMessage,
    logger,
    MessageType,
    parse,
    SocketMessage,
} from "./socket_messages.ts";

export class ServerConnection {
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
                const message = parse(event.data);
                this.handleMessage(message);
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
            case MessageType.PROPOSAL: {
                this.setTranscription(message.data ?? "");
                break;
            }
            case MessageType.ERROR: {
                logger.error(message, "WebSocket error message");
                break;
            }
            case MessageType.DEBUG:
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