import { type Signal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { arrayBufferToBase64 } from "../../lib/buffer_transformations.ts";

export interface SegmentMessage {
  type:
    | "VAD_START"
    | "VAD_STOP"
    | "UTTERANCE"
    | "SEGMENT"
    | "PARTIAL_TRANSCRIPTION"
    | "TRANSCRIPTION"
    | "ERROR";
  data?: string;
}

interface SpeechInputProps {
  onSegment: (message: SegmentMessage) => void;
}

export default function SpeechInput(props: SpeechInputProps) {
  const isListening = useSignal(false);
  const isVoiceDetected = useSignal(false);

  useEffect(() => {
    let cleanupFunc = () => {};
    if (isListening.value) {
      cleanupFunc = setupMicrophone(props, isVoiceDetected, isListening);
    }
    return cleanupFunc;
  }, [isListening.value]);

  return (
    <div>
      <label>
        <input
          type="checkbox"
          checked={isListening.value}
          onChange={() => {
            isListening.value = !isListening.value;
          }}
        />
        Is listening?
      </label>
      <label>
        <input type="checkbox" checked={isVoiceDetected.value} disabled />
        Voice detected?
      </label>
    </div>
  );
}

function setupMicrophone(
  props: SpeechInputProps,
  isVoiceDetected: Signal<boolean>,
  isListening: Signal<boolean>,
) {
  let mediaRecorder: MediaRecorder | null = null;
  let mediaStream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
  let vadNode: AudioWorkletNode | null = null;
  let mediaStreamSource: MediaStreamAudioSourceNode | null = null;

  // Initialize the mimeType
  let mimeType = "";
  if (MediaRecorder.isTypeSupported("audio/webm; codecs=opus")) {
    mimeType = "audio/webm; codecs=opus";
  } else if (MediaRecorder.isTypeSupported("audio/webm")) {
    mimeType = "audio/webm";
  } else if (MediaRecorder.isTypeSupported("audio/ogg; codecs=opus")) {
    mimeType = "audio/ogg; codecs=opus";
  } else {
    console.error("No supported MIME type found for MediaRecorder.");
    return () => {};
  }

  let lastSegment: ArrayBuffer | null = null;

  // Setup voice activity detection & record ongoing segments of audio
  navigator.mediaDevices
    .getUserMedia({ audio: true })
    .then(async (stream) => {
      mediaStream = stream;

      audioContext = new AudioContext();

      // Load VAD AudioWorklet
      await audioContext.audioWorklet.addModule("/vad-audio-worklet.js");

      vadNode = new AudioWorkletNode(audioContext, "vad", {
        processorOptions: {
          sampleRate: audioContext.sampleRate,
          fftSize: 512,
        },
      });

      mediaStreamSource = audioContext.createMediaStreamSource(stream);
      mediaStreamSource.connect(vadNode);

      // Handle VAD messages
      vadNode.port.onmessage = (event) => {
        const cmd = event.data["cmd"];
        if (cmd === "speech") {
          isVoiceDetected.value = true;
          if (!mediaRecorder || mediaRecorder.state === "inactive") {
            startRecording();
            // Notify the parent component that VAD has started
            props.onSegment({ type: "VAD_START" });
          }
        } else if (cmd === "noise" || cmd === "silence") {
          isVoiceDetected.value = false;
          if (mediaRecorder && mediaRecorder.state === "recording") {
            stopRecording();
            // Notify the parent component that VAD has stopped
            props.onSegment({ type: "VAD_STOP" });
          }
        }
      };

      function recordSegment() {
        // Create a separate recorder for ongoing segment recording
        // This lets us send in the few milliseconds of audio before VAD starts, preserving onset consonants, and allows for the server to provide ongoing transcription
        const segmentRecorder = new MediaRecorder(stream, { mimeType });
        segmentRecorder.ondataavailable = async (event) => {
          // console.log("Segment recording available", event.data.size);
          if (event.data && event.data.size > 0) {
            lastSegment = await event.data.arrayBuffer();
            // Send the ongoing segment to the parent component
            if (isVoiceDetected.value) {
              props.onSegment({
                type: "SEGMENT",
                data: arrayBufferToBase64(lastSegment),
              });
            }
          }
        };
        setTimeout(() => {
          segmentRecorder.stop();
          recordSegment();
        }, 500);
        if (segmentRecorder.state === "inactive" && isListening.value) {
          segmentRecorder.start();
        }
      }

      recordSegment();
    })
    .catch((error) => {
      console.error("Error accessing microphone:", error);
    });

  function startRecording() {
    if (!mediaStream) {
      console.error("Media stream is not available.");
      return;
    }

    // Send the last segment of "silence" to capture initial consonants
    if (lastSegment) {
      props.onSegment({
        type: "SEGMENT",
        data: arrayBufferToBase64(lastSegment),
      });
    }

    mediaRecorder = new MediaRecorder(mediaStream, { mimeType });

    mediaRecorder.ondataavailable = async (event) => {
      console.log("Data available:", event.data.size);
      if (event.data && event.data.size > 0) {
        console.log({ event });
        // Send the complete utterance to the parent component
        const buffer = await event.data.arrayBuffer();
        props.onSegment({
          type: "UTTERANCE",
          data: arrayBufferToBase64(buffer),
        });
      }
    };

    mediaRecorder.start();
  }

  function stopRecording() {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }
  }

  function cleanup() {
    stopRecording();
    if (vadNode) {
      vadNode.disconnect();
      vadNode.port.close();
      vadNode = null;
    }
    if (mediaStreamSource) {
      mediaStreamSource.disconnect();
      mediaStreamSource = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
  }

  // Return cleanup function
  return cleanup;
}
