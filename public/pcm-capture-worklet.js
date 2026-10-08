// Runs on the audio thread. Turns mic audio (at the device's native rate) into
// 16-bit PCM chunks at the target rate for Deepgram.
//
// PRIVACY: each chunk's buffer is transferred (not copied) to the main thread,
// which sends it on the socket and drops the reference. Nothing accumulates here
// beyond the single chunk being filled and a ~2 ms filter history.

// Anti-aliasing low-pass applied before downsampling (Hamming-windowed sinc).
const FILTER_TAPS = 81;
const CUTOFF_RATIO = 0.45; // of the output rate: 7.2 kHz for 16 kHz output

// The boost, for a TV across the room rather than a headset (testrun, Oct 3).
// A raw built-in mic hears a TV at -40 dB or quieter, which Deepgram mostly
// takes for silence. This follows the loudest recent speech and raises it
// towards BOOST_TARGET_DB, slowly enough not to pump, and never by more than
// BOOST_MAX_DB. It only ever raises: a headset already at level is untouched.
// Off (`boost: false`) the samples are exactly what they were before.
const BLOCK_MS = 20; // the level is measured over blocks this long
const BOOST_TARGET_DB = -20; // where the loudest recent speech is raised to
const BOOST_MAX_DB = 20; // never more boost than this
const BOOST_FLOOR_DB = -60; // quieter than this is silence, never chased
const LEVEL_RELEASE_S = 8; // how slowly the followed level falls after speech
const BOOST_RISE_S = 2; // how slowly the boost goes up
const BOOST_FALL_S = 0.1; // how quickly it comes down when the sound gets loud
const LIMIT_AT = 0.9; // above this, samples are softly limited rather than clipped
const LEVEL_EVERY_MS = 1000; // how often the level is reported to the page

const fromDb = (db) => Math.pow(10, db / 20);
const toDb = (linear) => 20 * Math.log10(Math.max(linear, 1e-9));

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
    const { chunkMs = 50, targetSampleRate = 16000, boost = false } = options.processorOptions ?? {};
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

    this.boost = Boolean(boost);
    this.gain = 1;
    this.level = fromDb(BOOST_FLOOR_DB);
    this.blockSize = Math.max(1, Math.round((this.outRate * BLOCK_MS) / 1000));
    this.blockSum = 0;
    this.blockCount = 0;
    this.blocksPerReport = Math.max(1, Math.round(LEVEL_EVERY_MS / BLOCK_MS));
    this.blocksSinceReport = 0;
    const blockSeconds = this.blockSize / this.outRate;
    this.releaseFactor = Math.exp(-blockSeconds / LEVEL_RELEASE_S);
    this.riseStep = 1 - Math.exp(-blockSeconds / BOOST_RISE_S);
    this.fallStep = 1 - Math.exp(-blockSeconds / BOOST_FALL_S);
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

  /** Measures the level (before any boost) and moves the boost once per block. */
  measure(sample) {
    this.blockSum += sample * sample;
    if (++this.blockCount < this.blockSize) return;
    const rms = Math.sqrt(this.blockSum / this.blockCount);
    this.blockSum = 0;
    this.blockCount = 0;

    // Follow the loudest recent speech: up quickly, down slowly.
    this.level = rms > this.level ? this.level + (rms - this.level) * 0.5 : this.level * this.releaseFactor;
    const floor = fromDb(BOOST_FLOOR_DB);
    if (this.level < floor) this.level = floor;

    if (this.boost) {
      const wanted = Math.min(fromDb(BOOST_MAX_DB), Math.max(1, fromDb(BOOST_TARGET_DB) / this.level));
      this.gain += (wanted - this.gain) * (wanted > this.gain ? this.riseStep : this.fallStep);
    }

    if (++this.blocksSinceReport >= this.blocksPerReport) {
      this.blocksSinceReport = 0;
      this.port.postMessage({ type: "level", speechDb: toDb(this.level), gainDb: toDb(this.gain) });
    }
  }

  emit(raw) {
    this.measure(raw);
    let sample = raw * this.gain;
    if (this.boost) {
      // Soft limit, so a sudden loud moment is rounded off rather than clipped.
      const size = Math.abs(sample);
      if (size > LIMIT_AT) sample = Math.sign(sample) * (LIMIT_AT + (1 - LIMIT_AT) * Math.tanh((size - LIMIT_AT) / (1 - LIMIT_AT)));
    }
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
