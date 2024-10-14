import { type Signal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { arrayBufferToBase64 } from "../../lib/buffer_transformations.ts";

interface SegmentMessage {
  type: "VAD_START" | "VAD_STOP" | "UTTERANCE" | "SEGMENT";
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
      cleanupFunc = setupMicrophone(props, isVoiceDetected);
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
    })
    .catch((error) => {
      console.error("Error accessing microphone:", error);
    });

  function startRecording() {
    if (!mediaStream) {
      console.error("Media stream is not available.");
      return;
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
