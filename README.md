# Dragon Ball Scouter

A camera toy: point your phone at a face, lock on, and read its power level. Yell to power up — break 9000 and the scouter cracks.

Live: https://jyunhanlin.github.io/dragon-ball-scouter/

- Base power: facial-geometry ratios mapped to a log scale — the same person scores roughly the same on every scan
- Boost: MediaPipe blendshapes (jawOpen / browDown / eyeWide) drive a multiplier up to ×10
- Everything runs on-device; camera frames never leave the browser

## Dev

```bash
pnpm install
pnpm dev     # https://localhost:5173 (self-signed cert — click through the warning)
pnpm test    # vitest: power / fsm / hud transform
```

## Testing on your phone

1. Run `pnpm dev` and find the Network URL in the terminal (https://192.168.x.x:5173)
2. Open it on a phone on the same Wi-Fi and accept the self-signed-cert warning
3. The rear camera starts by default; the bottom-right button flips front/back
