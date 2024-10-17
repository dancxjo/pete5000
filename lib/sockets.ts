export enum MessageType {
    FRAGMENT = "FRAGMENT",
    ERROR = "ERROR",
    DEBUG = "TREE",
}

export interface SocketMessage {
    type: MessageType;
    data?: string;
}

export function isValidSocketMessage(x: unknown): x is SocketMessage {
    if (typeof x !== "object" || x === null) {
        return false;
    }
    const message = x as SocketMessage;
    if (typeof message.type !== "string") {
        return false;
    }
    if (message.data !== undefined && typeof message.data !== "string") {
        return false;
    }
    return true;
}

export interface FragmentMessage {
    type: MessageType.FRAGMENT;
    data: string;
    recordedAt: string; // ISO 8601 timestamp
}

export function isValidFragmentMessage(x: unknown): x is FragmentMessage {
    if (!isValidSocketMessage(x)) {
        return false;
    }
    const message = x as FragmentMessage;
    if (message.type !== MessageType.FRAGMENT) {
        return false;
    }
    if (typeof message.recordedAt !== "string") {
        return false;
    }
    return true;
}
