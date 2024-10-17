import { type Signal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { arrayBufferToBase64 } from "../../lib/buffer_transformations.ts";
import { type FragmentMessage, MessageType } from "../../lib/sockets.ts";
import { pino } from "npm:pino";

const logger = pino({ level: "info", browser: { asObject: true } });

interface SpeechInputProps {
  // This will not be awaited
  onFragment: (message: FragmentMessage) => void | Promise<void>;
}

export default function SpeechInput(props: SpeechInputProps) {
  const isListening = useSignal(false);

  const startListening = () => {
    logger.info("Starting microphone...");
    setupMicrophone(props, isListening);
  };

  const stopListening = () => () => {
    logger.info("Stopping microphone...");
  };

  useEffect(() => {
    let cleanup = () => {};
    if (isListening.value) {
      cleanup = startListening() ?? cleanup;
    } else cleanup = stopListening();
    return cleanup;
  }, [
    isListening.value,
  ]);

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
        Listen
      </label>
    </div>
  );
}

type Callback = () => void;

function setupMicrophone(
  props: SpeechInputProps,
  isListening: Signal<boolean>,
) {
  let mediaStream: MediaStream | null = null;
  let audioContext: AudioContext | null = null;
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
    .then((stream) => {
      const segmentRecorder = new MediaRecorder(stream, { mimeType });

      mediaStream = stream;
      audioContext = new AudioContext();

      const recordSegment = () => {
        logger.info("Recording next segment...");
        segmentRecorder.ondataavailable = async (event) => {
          console.log("Segment data available:", event.data.size);
          // console.log("Segment recording available", event.data.size);
          if (event.data && event.data.size > 0) {
            const segData = await event.data.arrayBuffer();
            props.onFragment({
              type: MessageType.FRAGMENT,
              data: arrayBufferToBase64(segData),
              recordedAt: new Date().toISOString(),
            });
          }
        };
      };
      setTimeout(() => {
        segmentRecorder.stop();
        recordSegment();
      }, 500);
      if (segmentRecorder.state === "inactive" && isListening.value) {
        segmentRecorder.start();
      }

      recordSegment();
    })
    .catch((error) => {
      console.error("Error accessing microphone:", error);
    });

  function cleanup() {
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
