# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev                          # HTTPS dev server (basic-ssl, host:true for phone testing on LAN)
pnpm test                         # vitest run — all tests
pnpm vitest run src/power.test.ts # single test file
pnpm vitest run -t "basePower"    # tests matching a name
pnpm build                        # tsc type-check (includes *.test.ts) + vite build
```

Deploy: push to `main` → GitHub Actions runs test + build → GitHub Pages at https://jyunhanlin.github.io/dragon-ball-scouter/. There is no staging; the workflow is the gate.

## Architecture

Browser-only toy (no backend): camera frames → face detection → "power level" math → canvas HUD. One `requestAnimationFrame` loop in `main.ts` is the only place modules meet; every other file is a leaf with no cross-imports except types.

Per-frame pipeline:

```
camera.ts (getUserMedia stream)
  → detector.ts (MediaPipe FaceLandmarker: picks largest face, converts
    normalized landmarks to video-pixel space, blendshapes → record)
  → power.ts (geometry ratios → stable base power; blendshapes → boost ×1–10)
  → fsm.ts (idle→searching→locked→scanning→result→overload, face-lost debounce)
  → hud.ts (coverTransform/toScreen mapping + Hud canvas drawing) + sfx.ts (WebAudio beeps)
```

**Purity split (drives what's testable):** `power.ts`, `fsm.ts`, and the transform functions in `hud.ts` are pure — no browser APIs — and are the only unit-tested code. `camera.ts`, `detector.ts`, `sfx.ts`, and the `Hud` class are browser-bound and verified manually in a real browser (camera permission can't be automated).

## Invariants that span files

- **One clock:** `performance.now()` (ms) feeds both `fsm.tick` timestamps and `detectForVideo`. Don't introduce `Date.now()` or seconds anywhere in that chain.
- **Pixel space, not normalized:** `detector.ts` multiplies landmarks by `videoWidth/videoHeight` before anything else sees them, so `computeRatios`' mixed horizontal/vertical ratios are aspect-correct. Landmark indices in `power.ts` (33/263/234/454/168/1/10/152/61/291) are MediaPipe FaceLandmarker canonical points.
- **Mirroring chain:** `facing === 'user'` drives both the CSS `scaleX(-1)` on `#cam` and the x-flip in `toScreen`; box reconstruction in `main.ts` uses `min/abs` because mirroring reverses corner order. Change one side and the reticle drifts off the face.
- **MediaPipe versions move in lockstep:** `package.json` pins `@mediapipe/tasks-vision` exactly, and `WASM_URL` in `detector.ts` hardcodes the same version on the CDN. Bump both together or the JS loader and WASM runtime skew.
- **The 3D hair layer (`hair3d.ts`, three.js) is garnish, not core:** it loads as a lazy chunk during the boot screen (non-fatal — boot line shows SKIP if WebGL/chunk fails) and renders ONLY while transformed (`display:none` + no render otherwise). It draws on its own canvas between the video and the HUD canvas with `mix-blend-mode: screen`, so it can only ADD light — never rely on it darkening anything. Effects renderer is pinned to `pixelRatio 1` on purpose (bloom cost scales with pixels); check `?debug`'s fps line before making it heavier.
- **Head-pose quaternion axis flips in `hair3d.ts` are paper-derived**, not device-verified — if hair rotates opposite to the head, fix the sign pattern in the `group.quaternion.set` calls, nothing else.
- **Manual `start()` bypasses `onTransition`:** the restart button handler in `main.ts` must mirror `onTransition`'s searching-entry branch (see comment there). Side effects added to one must be added to the other.
- **Tunable game constants** live exported at the top of `power.ts` (`BASE_MIN/BASE_MAX/OVER_LIMIT/MAX_BOOST`) and `fsm.ts` (`LOCK_MS/SCAN_MS/LOST_MS`) — tune there, not inline.

## Gotchas

- **Effort's reachable range is ~0–0.5, not 0–1.** `effortFromBlend` weights sum to 1 on paper, but real MediaPipe blendshapes cap far lower (measured full-yell ≈ 0.45: jaw contributes ≤0.6 and brow/eye are antagonistic to an open jaw). Any threshold on effort must be calibrated against the `?debug` overlay (append `?debug` to the URL for live effort/charge/blendshape readouts) — never against paper math. SSJ_EFFORT=0.35 came from this measurement.

- `getUserMedia` requires a secure context: dev uses the basic-ssl self-signed cert (click through the browser warning); phone testing uses the Network URL over the same Wi-Fi.
- `packageManager` pnpm version matters in CI: 11.12.0 crashed `pnpm/action-setup`'s self-update (fixed at 11.14+). Don't downgrade it.
- `pnpm test` (vitest) does not type-check; `pnpm build`'s `tsc` step does, and it includes test files. Run build before claiming type safety.
- `docs/superpowers/` (design spec + implementation plan) is intentionally untracked (gitignored) — local reference only.
