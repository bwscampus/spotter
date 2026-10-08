// One short tone when the silence alarm goes up (Part 6, Oct 4), so the
// announcer looking at the field hears that Spotter stopped hearing them.
// Played on the mic's own AudioContext when there is one, so it needs no
// second permission; a context of its own otherwise, closed when it ends.

export const TONE_HZ = 880;
export const TONE_MS = 200;
const TONE_GAIN = 0.2;

export function playAlarmTone(context: AudioContext | null): void {
  try {
    const own = context ?? new AudioContext();
    const oscillator = own.createOscillator();
    const gain = own.createGain();
    oscillator.frequency.value = TONE_HZ;
    gain.gain.value = TONE_GAIN;
    oscillator.connect(gain);
    gain.connect(own.destination);
    const at = own.currentTime;
    oscillator.start(at);
    oscillator.stop(at + TONE_MS / 1000);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      if (!context) void own.close();
    };
  } catch {
    // No audio output: the red bar is still on screen.
  }
}
