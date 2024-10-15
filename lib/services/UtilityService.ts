import { split as sentenceSplitter } from "npm:sentence-splitter";

export interface ControlMessage {
    type: "VAD_START" | "VAD_STOP" | "UTTERANCE" | "SEGMENT";
    data?: string;
}

export class UtilityService {
    static isValidControlMessage(message: unknown): message is ControlMessage {
        return (
            !!message &&
            typeof message === "object" &&
            "type" in message &&
            typeof (message as any).type === "string"
        );
    }

    static throttle(func: () => void, wait: number) {
        let lastCalled = 0;
        return () => {
            const now = Date.now();
            if (now - lastCalled >= wait) {
                lastCalled = now;
                func();
            }
        };
    }

    static debounce(func: () => void, wait: number) {
        let timeout: number | null = null;
        return () => {
            if (timeout) {
                clearTimeout(timeout);
            }
            timeout = setTimeout(() => {
                func();
            }, wait);
        };
    }

    static splitIntoSentences(text: string): string[] {
        return sentenceSplitter(text).filter((node) => node.type === "Sentence")
            .map((node) => node.raw);
    }
}
