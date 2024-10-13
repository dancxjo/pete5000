import { type Signal, useSignal } from "@preact/signals";
import { useEffect } from "preact/hooks";

interface SpeechInputProps {
    ws: Signal<WebSocket | null>;
}

export default function SpeechInput(props: SpeechInputProps) {
    const ws = useSignal(props.ws);
    const isVoiceDetected = useSignal(false);
    const isListening = useSignal(false);
    const audioContext = new AudioContext();
    let mediaStreamSource: MediaStreamAudioSourceNode | null = null;

    useEffect(() => {
        if (isListening.value) {
            // Access the microphone when isListening is true
            navigator.mediaDevices.getUserMedia({ audio: true }).then(
                async (stream) => {
                    // Add the VAD audio worklet module
                    await audioContext.audioWorklet.addModule(
                        "/vad-audio-worklet.js",
                    );

                    // Create the VAD AudioWorkletNode
                    const vad = new AudioWorkletNode(audioContext, "vad", {
                        outputChannelCount: [1],
                        processorOptions: {
                            sampleRate: audioContext.sampleRate, // sample rate of the audio input
                            fftSize: 128, // optional change fft size, default: 128
                        },
                    });

                    // Connect the microphone stream to the VAD node
                    mediaStreamSource = audioContext.createMediaStreamSource(
                        stream,
                    );
                    mediaStreamSource.connect(vad);

                    // Listen for VAD messages
                    vad.port.onmessage = (event) => {
                        const cmd = event.data["cmd"];
                        console.log("Received command:", cmd);

                        if (cmd === "speech") {
                            isVoiceDetected.value = true;
                        }

                        if (cmd === "silence") {
                            isVoiceDetected.value = false;
                        }
                    };
                },
            ).catch((err) => {
                console.error("Microphone access error:", err);
            });
        }

        // Clean up the media stream and audio context when isListening is false or component unmounts
        return () => {
            if (mediaStreamSource) {
                mediaStreamSource.disconnect();
                mediaStreamSource = null;
            }
            audioContext.close();
        };
    }, [isListening.value]);

    if (!ws.value) {
        return (
            <div>
                <p>Connecting...</p>
            </div>
        );
    }

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
                <input
                    type="checkbox"
                    checked={isVoiceDetected.value}
                    readOnly
                />
                Voice detected?
            </label>
        </div>
    );
}
