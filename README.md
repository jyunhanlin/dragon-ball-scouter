# 戰鬥力探測器 Dragon Ball Scouter

用鏡頭偵測人臉、顯示「戰鬥力」的趣味網頁。張嘴大吼可以發力，破 9000 會爆表。

- 基礎值：臉部幾何比值 → 對數尺度（同一人每次測都相近）
- 加成：MediaPipe blendshapes（jawOpen / browDown / eyeWide）→ 最高 ×10
- 全部在裝置端運算，影像不上傳

Live: https://jyunhanlin.github.io/dragon-ball-scouter/

## Dev

```bash
pnpm install
pnpm dev     # https://localhost:5173（自簽憑證，按「繼續前往」）
pnpm test    # vitest：power / fsm / hud transform
```

## 手機測試

1. `pnpm dev` 後找 terminal 顯示的 Network URL（https://192.168.x.x:5173）
2. 手機與電腦同一 Wi-Fi，開該網址，接受自簽憑證警告
3. 預設開後鏡頭；右下角按鈕切換前後鏡頭
