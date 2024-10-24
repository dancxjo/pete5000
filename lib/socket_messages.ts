import { IS_BROWSER } from "$fresh/runtime.ts";
import { pino } from "npm:pino";
import type { TimelineItem } from "npm:vis-timeline";

export const logger = pino({
    level: "info",
    browser: { asObject: IS_BROWSER ? true : undefined },
});

export enum MessageType {
    FRAGMENT = "FRAGMENT",
    PROPOSAL = "PROPOSAL",
    ERROR = "ERROR",
    DEBUG = "TREE",
    VTT = "VTT",
    GUESS = "GUESS",
    LOCATION = "LOCATION",
}

export interface SocketMessage {
    type: MessageType;
    data?: unknown;
}

export function isValidSocketMessage(x: unknown): x is SocketMessage {
    if (typeof x !== "object" || x === null) {
        return false;
    }
    const message = x as SocketMessage;
    if (typeof message.type !== "string") {
        return false;
    }
    return true;
}

export interface FragmentMessage extends SocketMessage {
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

export interface GuessMessage extends SocketMessage {
    type: MessageType.GUESS;
    data: TimelineItem;
}

export function isValidGuessMessage(x: unknown): x is GuessMessage {
    if (!isValidSocketMessage(x)) {
        return false;
    }
    const message = x as unknown as GuessMessage;
    if (message.type !== MessageType.GUESS) {
        return false;
    }
    if (
        !message.data || typeof message.data !== "object" ||
        message.data === null || !("item" in message.data) ||
        !("start" in message.data) || !("end" in message.data)
    ) {
        return false;
    }
    return true;
}

export type MessageHandler = (msg: SocketMessage) => Promise<void>;

export function decodeWebmString(data: string): Uint8Array {
    logger.debug(data, "Decoding WebM string");
    return new Uint8Array(atob(data).split("").map((c) => c.charCodeAt(0)));
}

export function parse(data: string): SocketMessage {
    try {
        const potential = JSON.parse(data);
        if (isValidSocketMessage(potential)) {
            return potential;
        }
        throw new Error("Invalid message");
    } catch (err) {
        logger.error({ err }, "Failed to parse message");
        return { type: MessageType.ERROR, data: "Invalid JSON" };
    }
}
