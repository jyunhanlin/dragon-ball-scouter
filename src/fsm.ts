import { isOverload } from './power';

// 可調常數
export const LOCK_MS = 600;
export const SCAN_MS = 1200;
export const LOST_MS = 1000;

export type Phase = 'idle' | 'searching' | 'locked' | 'scanning' | 'result' | 'overload';

export interface FsmState {
  phase: Phase;
  /** 進入目前 phase 的時間戳 */
  phaseAt: number;
  /** 最後一次看到臉的時間戳 */
  lastFaceAt: number;
}

export interface FrameInput {
  now: number;
  faceVisible: boolean;
  displayValue: number;
}

export function initial(): FsmState {
  return { phase: 'idle', phaseAt: 0, lastFaceAt: 0 };
}

export function start(s: FsmState, now: number): FsmState {
  if (s.phase === 'idle' || s.phase === 'overload') {
    return { phase: 'searching', phaseAt: now, lastFaceAt: 0 };
  }
  return s;
}

export function tick(s: FsmState, input: FrameInput): FsmState {
  const { now, faceVisible, displayValue } = input;
  const lastFaceAt = faceVisible ? now : s.lastFaceAt;
  const lost = !faceVisible && now - lastFaceAt >= LOST_MS;

  switch (s.phase) {
    case 'idle':
    case 'overload':
      return s;
    case 'searching':
      return faceVisible ? { phase: 'locked', phaseAt: now, lastFaceAt } : s;
    case 'locked':
      if (lost) return { phase: 'searching', phaseAt: now, lastFaceAt };
      if (now - s.phaseAt >= LOCK_MS) return { phase: 'scanning', phaseAt: now, lastFaceAt };
      return { ...s, lastFaceAt };
    case 'scanning':
      if (lost) return { phase: 'searching', phaseAt: now, lastFaceAt };
      if (now - s.phaseAt >= SCAN_MS) return { phase: 'result', phaseAt: now, lastFaceAt };
      return { ...s, lastFaceAt };
    case 'result':
      if (lost) return { phase: 'searching', phaseAt: now, lastFaceAt };
      if (isOverload(displayValue)) return { phase: 'overload', phaseAt: now, lastFaceAt };
      return { ...s, lastFaceAt };
  }
}
