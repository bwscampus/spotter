// Runs on the audio thread. Turns mic audio (at the device's native rate) into
// 16-bit PCM chunks at the target rate for Deepgram.
//
// PRIVACY: each chunk's buffer is transferred (not copied) to the main thread,
// which sends it on the socket and drops the reference. Nothing accumulates here
// beyond the single chunk being filled and a ~2 ms filter history.

// Anti-aliasing low-pass applied before downsampling (Hamming-windowed sinc).
const FILTER_TAPS = 81;
const CUTOFF_RATIO = 0.45; // of the output rate: 7.2 kHz for 16 kHz output

function designLowPass(taps, cutoffHz, rate) {
  const h = new Float32Array(taps);
  const middle = (taps - 1) / 2;
  const fc = cutoffHz / rate;
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const x = i - middle;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const hamming = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1));
    h[i] = sinc * hamming;
    sum += h[i];
  }
  for (let i = 0; i < taps; i++) h[i] /= sum; // unity gain at DC
  return h;
}

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const { chunkMs = 50, targetSampleRate = 16000 } = options.processorOptions ?? {};
    this.outRate = Math.min(targetSampleRate, sampleRate);
    // Input samples per output sample (3 for 48 kHz -> 16 kHz).
    this.step = sampleRate / this.outRate;
    this.resampling = this.step > 1;
    if (this.resampling) {
      this.taps = designLowPass(FILTER_TAPS, this.outRate * CUTOFF_RATIO, sampleRate);
      // Each sample is stored twice so the filter window is always contiguous.
      this.history = new Float32Array(FILTER_TAPS * 2);
      this.historyPos = 0;
      this.prev = 0;
      this.t = 1;
    }
    this.chunkSize = Math.max(1, Math.round((this.outRate * chunkMs) / 1000));
    this.chunk = new Int16Array(this.chunkSize);
    this.offset = 0;
    this.stopped = false;
    this.port.onmessage = (event) => {
      if (event.data === "stop") {
        this.stopped = true;
        this.chunk = null;
        this.history = null;
      }
    };
  }

  process(inputs) {
    if (this.stopped) return false;
    const channels = inputs[0];
    if (!channels || channels.length === 0) return true;

    const frames = channels[0].length;
    const channelCount = channels.length;
    for (let i = 0; i < frames; i++) {
      let sample = 0;
      for (let c = 0; c < channelCount; c++) sample += channels[c][i];
      sample /= channelCount;

      if (!this.resampling) {
        this.emit(sample);
        continue;
      }

      const pos = this.historyPos;
      this.history[pos] = sample;
      this.history[pos + FILTER_TAPS] = sample;
      this.historyPos = pos + 1 === FILTER_TAPS ? 0 : pos + 1;
      let filtered = 0;
      const oldest = this.historyPos;
      for (let k = 0; k < FILTER_TAPS; k++) filtered += this.taps[k] * this.history[oldest + k];

      // Linear interpolation of the filtered signal onto the output sample grid.
      while (this.t <= 1) {
        this.emit(this.prev + (filtered - this.prev) * this.t);
        this.t += this.step;
      }
      this.t -= 1;
      this.prev = filtered;
    }
    return true;
  }

  emit(sample) {
    const s = sample < -1 ? -1 : sample > 1 ? 1 : sample;
    this.chunk[this.offset++] = s < 0 ? s * 0x8000 : s * 0x7fff;
    if (this.offset === this.chunkSize) {
      this.port.postMessage(this.chunk.buffer, [this.chunk.buffer]);
      this.chunk = new Int16Array(this.chunkSize);
      this.offset = 0;
    }
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
