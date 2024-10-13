var S = "[DETECTION]", F = ["error", "debug", "warn"];
function g(a) {
    return (...e) => {
        console[a](S, ...e);
    };
}
var b = F.reduce((a, e) => (a[e] = g(e), a), {}), o = b;
var f = {
    positiveSpeechThreshold: .5,
    negativeSpeechThreshold: .5 - .15,
    preSpeechPadFrames: 1,
    redemptionFrames: 8,
    frameSamples: 1536,
    minSpeechFrames: 3,
    submitUserSpeechOnPause: !1,
};
var u = class u {
    constructor(e, t) {
        this.ort = e;
        this.modelFetcher = t;
        this.init = async () => {
            o.debug("initializing detection");
            let e = await this.modelFetcher();
            this._session = await this.ort.InferenceSession.create(e),
                this._sr = new this.ort.Tensor("int64", [16000n]),
                this.reset_state(),
                o.debug("detection is initialized");
        };
        this.reset_state = () => {
            let e = Array(128).fill(0);
            this._h = new this.ort.Tensor("float32", e, [2, 1, 64]),
                this._c = new this.ort.Tensor("float32", e, [2, 1, 64]);
        };
        this.process = async (e) => {
            let r = {
                    input: new this.ort.Tensor("float32", e, [1, e.length]),
                    h: this._h,
                    c: this._c,
                    sr: this._sr,
                },
                i = await this._session.run(r);
            this._h = i.hn, this._c = i.cn;
            let s = i.output.data[0];
            return { notSpeech: 1 - s, isSpeech: s };
        };
    }
};
u.new = async (e, t) => {
    let r = new u(e, t);
    return await r.init(), r;
};
var c = u;
var p = class {
    constructor(e) {
        this.options = e;
        this.process = (e) => {
            let t = [];
            for (this.fillInputBuffer(e); this.hasEnoughDataForFrame();) {
                let r = this.generateOutputFrame();
                t.push(r);
            }
            return t;
        };
        e.nativeSampleRate < 16e3 &&
        o.error(
            "nativeSampleRate is too low. Should have 16000 = targetSampleRate <= nativeSampleRate",
        ), this.inputBuffer = [];
    }
    *stream(e) {
        for (this.fillInputBuffer(e); this.hasEnoughDataForFrame();) {
            yield this.generateOutputFrame();
        }
    }
    fillInputBuffer(e) {
        for (let t of e) this.inputBuffer.push(t);
    }
    hasEnoughDataForFrame() {
        return this.inputBuffer.length * this.options.targetSampleRate /
                this.options.nativeSampleRate >= this.options.targetFrameSize;
    }
    generateOutputFrame() {
        let e = new Float32Array(this.options.targetFrameSize), t = 0, r = 0;
        for (; t < this.options.targetFrameSize;) {
            let i = 0, s = 0;
            for (
                ;
                r <
                    Math.min(
                        this.inputBuffer.length,
                        (t + 1) * this.options.nativeSampleRate /
                            this.options.targetSampleRate,
                    );
            ) {
                let n = this.inputBuffer[r];
                n !== void 0 && (i += n, s++), r++;
            }
            e[t] = i / s, t++;
        }
        return this.inputBuffer = this.inputBuffer.slice(r), e;
    }
};
var W = { ...f, ortConfig: void 0 };
var m = class extends AudioWorkletProcessor {
    constructor(t) {
        super();
        this._initialized = !1;
        this._stopProcessing = !1;
        this.init = () => {
            o.debug("initializing worklet"),
                this.resampler = new p({
                    nativeSampleRate: sampleRate,
                    targetSampleRate: 16e3,
                    targetFrameSize: this.options.frameSamples,
                }),
                this._initialized = !0,
                o.debug("initialized worklet");
        };
        this.options = t.processorOptions,
            this.port.onmessage = (r) => {
                r.data.message === "SPEECH_STOP" && (this._stopProcessing = !0);
            },
            this.init();
    }
    process(t, r, i) {
        if (this._stopProcessing) return !1;
        let s = t[0][0];
        if (this._initialized && s instanceof Float32Array) {
            let n = this.resampler.process(s);
            for (let h of n) {
                this.port.postMessage({
                    message: "AUDIO_FRAME",
                    data: h.buffer,
                }, [h.buffer]);
            }
        }
        return !0;
    }
};
registerProcessor("voice-worklet", m);
