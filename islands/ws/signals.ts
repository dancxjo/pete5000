import { signal } from "@preact/signals";

export const ws = signal<WebSocket | null>(null);

export function initializeWebSocket() {
    const host = globalThis.location.host;
    const protocol = globalThis.location.protocol;
    const wsProtocol = protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${wsProtocol}//${host}/api/chat`);

    socket.onopen = () => {
        console.log("WebSocket connected");
    };

    socket.onclose = () => {
        console.log("WebSocket disconnected");
    };

    ws.value = socket;
}
