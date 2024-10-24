// DO NOT EDIT. This file is generated by Fresh.
// This file SHOULD be checked into source version control.
// This file is automatically updated during development when running `dev.ts`.

import * as $_404 from "./routes/_404.tsx";
import * as $_app from "./routes/_app.tsx";
import * as $api_asr from "./routes/api/asr.ts";
import * as $api_stream from "./routes/api/stream.ts";
import * as $index from "./routes/index.tsx";
import * as $prompt from "./routes/prompt.tsx";
import * as $AsrTimeline from "./islands/AsrTimeline.tsx";
import * as $ChatSession from "./islands/ChatSession.tsx";
import * as $Heart from "./islands/Heart.tsx";
import * as $Transcription from "./islands/Transcription.tsx";
import * as $audio_SpeechInput from "./islands/audio/SpeechInput.tsx";
import * as $ws_signals from "./islands/ws/signals.ts";
import type { Manifest } from "$fresh/server.ts";

const manifest = {
  routes: {
    "./routes/_404.tsx": $_404,
    "./routes/_app.tsx": $_app,
    "./routes/api/asr.ts": $api_asr,
    "./routes/api/stream.ts": $api_stream,
    "./routes/index.tsx": $index,
    "./routes/prompt.tsx": $prompt,
  },
  islands: {
    "./islands/AsrTimeline.tsx": $AsrTimeline,
    "./islands/ChatSession.tsx": $ChatSession,
    "./islands/Heart.tsx": $Heart,
    "./islands/Transcription.tsx": $Transcription,
    "./islands/audio/SpeechInput.tsx": $audio_SpeechInput,
    "./islands/ws/signals.ts": $ws_signals,
  },
  baseUrl: import.meta.url,
} satisfies Manifest;

export default manifest;
