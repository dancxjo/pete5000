import type { Fragment } from "./Fragment.ts";
import type { Transcription } from "./whisper.ts";

export interface TranscriptCallbacks {
    onNewPrediction?: (transcription: Transcription) => void;
    onError?: (error: Error) => void;
    onStableFragment?: (stableFragment: Fragment) => void;
}
