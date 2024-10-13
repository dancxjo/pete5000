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
    const stream = useSignal<MediaStream | null>(null);
    const recordedAudio = useSignal<Blob[]>([]);
    let mediaStreamSource: MediaStreamAudioSourceNode | null = null;

    // Function to play audio chunks
    const playAudio = (blob: Blob) => {
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        audio.play();
    };

    useEffect(() => {
        let mediaRecorder: MediaRecorder | null = null;
        let chunks: Blob[] = [];

        if (isListening.value) {
            // Access the microphone when isListening is true
            navigator.mediaDevices.getUserMedia({ audio: true }).then(
                async (mediastream) => {
                    stream.value = mediastream;

                    // Set the VAD up
                    await audioContext.audioWorklet.addModule(
                        "/vad-audio-worklet.js",
                    );

                    // Create the VAD AudioWorkletNode
                    const vad = new AudioWorkletNode(audioContext, "vad", {
                        outputChannelCount: [1],
                        processorOptions: {
                            sampleRate: audioContext.sampleRate,
                            fftSize: 128,
                        },
                    });

                    // Connect the microphone stream to the VAD node
                    mediaStreamSource = audioContext.createMediaStreamSource(
                        stream.value,
                    );
                    mediaStreamSource.connect(vad);

                    // Listen for VAD messages
                    vad.port.onmessage = (event) => {
                        const cmd = event.data["cmd"];
                        if (cmd === "speech") {
                            isVoiceDetected.value = true;
                            if (
                                !mediaRecorder ||
                                mediaRecorder.state === "inactive"
                            ) {
                                // Start recording
                                mediaRecorder = new MediaRecorder(
                                    stream.value!,
                                );
                                mediaRecorder.ondataavailable = (e) => {
                                    const chunk = e.data;
                                    chunks.push(chunk);

                                    // Stream each chunk to WebSocket
                                    if (
                                        props.ws.value &&
                                        props.ws.value.readyState ===
                                            WebSocket.OPEN
                                    ) {
                                        props.ws.value.send(chunk);
                                    }
                                };

                                mediaRecorder.onstop = () => {
                                    // Push chunks to recordedAudio when stopped
                                    recordedAudio.value = [
                                        ...recordedAudio.value,
                                        ...chunks,
                                    ];
                                    chunks = [];
                                };

                                mediaRecorder.start();
                            }
                        }

                        if (cmd === "silence") {
                            isVoiceDetected.value = false;
                            if (
                                mediaRecorder &&
                                mediaRecorder.state === "recording"
                            ) {
                                mediaRecorder.stop();
                            }
                        }
                    };
                },
            ).catch((err) => {
                console.error("Microphone access error:", err);
            });
        }

        return () => {
            if (mediaStreamSource) {
                mediaStreamSource.disconnect();
                mediaStreamSource = null;
            }
            if (mediaRecorder && mediaRecorder.state !== "inactive") {
                mediaRecorder.stop();
            }
            audioContext.close();
        };
    }, [isListening.value]);

    if (!ws.value) {
        return <div>Connecting...</div>;
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

            <details>
                <summary>Recorded Audio Chunks</summary>
                <table>
                    <thead>
                        <tr>
                            <th>Chunk #</th>
                            <th>Play</th>
                        </tr>
                    </thead>
                    <tbody>
                        {recordedAudio.value.map((chunk, index) => (
                            <tr key={index}>
                                <td>{index + 1}</td>
                                <td>
                                    <button
                                        onClick={() => playAudio(chunk)}
                                    >
                                        Play
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </details>
        </div>
    );
}
