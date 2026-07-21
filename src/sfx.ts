let ac: AudioContext | null = null;

/** 必須在 user gesture（按啟動）內呼叫，否則 AudioContext 會被瀏覽器擋下 */
export function initAudio(): void {
  ac ??= new AudioContext();
  void ac.resume();
}

function beep(freq: number, delay: number, dur: number, type: OscillatorType = 'square', vol = 0.04): void {
  if (!ac) return;
  if (ac.state === 'suspended') void ac.resume();
  const t = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur);
}

export function playLock(): void {
  beep(1320, 0, 0.07);
  beep(1760, 0.09, 0.12);
}

export function playTick(): void {
  beep(880, 0, 0.03, 'square', 0.02);
}

export function playOverload(): void {
  if (!ac) return;
  if (ac.state === 'suspended') void ac.resume();
  beep(1200, 0, 0.4, 'sawtooth', 0.06);
  beep(600, 0.1, 0.5, 'sawtooth', 0.06);
  const len = Math.floor(ac.sampleRate * 0.4);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len); // 衰減白噪
  const src = ac.createBufferSource();
  const g = ac.createGain();
  g.gain.value = 0.15;
  src.buffer = buf;
  src.connect(g).connect(ac.destination);
  src.start();
}
