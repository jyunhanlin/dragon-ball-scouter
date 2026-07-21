# 七龍珠戰鬥力探測器 — Design Spec

日期：2026-07-21
狀態：已與使用者確認

## 目標

一個純前端的趣味網頁：用手機後鏡頭對準朋友，偵測人臉後播放鎖定/掃描動畫，顯示「戰鬥力」數值。數值由兩部分組成：同一人每次測都相近的**基礎值**，加上張嘴大吼、瞪眼等表情驅動的**即時加成**。突破 9000 觸發爆表彩蛋。

非目標（YAGNI）：

- 多目標同時顯示（僅鎖定畫面中最大的臉）
- 後端、帳號、分數保存與分享
- 桌機專屬版面（手機直式優先，桌機能用即可）

## 技術選型

- **Vite + vanilla TypeScript**：HUD 為 canvas 疊加 + 少量 DOM，不需要框架
- **MediaPipe Tasks Vision — FaceLandmarker**（VIDEO mode，開啟 blendshapes）：478 landmarks + 52 blendshapes，WASM/WebGL 裝置端推論，手機效能佳
- 取捨：MediaPipe 無身分 embedding，「同一人固定值」以臉部幾何比例近似（相近區間，非完美固定）。曾評估 face-api.js（有 descriptor 但已不維護、手機效能差）與混合方案（雙倍模型載入，對玩具專案過度工程），均否決
- **Vitest**：純函式單元測試
- 隱私：影像完全不離開裝置

## 模組切分

| 模組 | 職責 | 依賴 |
|---|---|---|
| `camera.ts` | getUserMedia 取流；手機預設 `facingMode: environment`，提供切換前/後鏡頭 | 無 |
| `detector.ts` | FaceLandmarker 封裝；每幀輸出 landmarks + blendshapes；多臉時回傳 bounding box 最大者 | MediaPipe |
| `power.ts` | 純函式：幾何比例 → 基礎值；blendshapes → 加成乘數；EMA 平滑 | 無（可單元測試） |
| `hud.ts` | Canvas 疊加：準心、鎖定動畫、數字滾動、掃描線、碎裂特效 | 無 |
| `sfx.ts` | WebAudio 合成音效：鎖定嗶聲、掃描聲、爆表音（不用版權素材） | 無 |
| `main.ts` | 狀態機，串接以上模組 | 全部 |

## 戰鬥力計算（power.ts）

- **基礎值**：從 landmarks 取對距離不敏感的幾何**比值**（眼距/臉寬、鼻長/臉高等）組成特徵向量 → hash 到對數尺度範圍。多數人落在 100～3000，少數天生高值。比值具距離不變性，同一人每次測結果相近。
- **表情加成**：`jawOpen`、`browDownLeft/Right`、`eyeWideLeft/Right` 加權為 0～1「發力度」，套加速曲線成最高約 ×10 乘數。
- **爆表**：顯示值 > 9000 → OVERLOAD。
- **平滑**：exponential moving average；顯示層用滾動數字。

## 狀態機（main.ts）

```
IDLE ─按啟動→ SEARCHING ─偵測到臉→ LOCKED（鎖定動畫+嗶聲）
     → SCANNING（~1s 亂數滾動）→ RESULT（基礎值+表情即時加成）
RESULT ─顯示值>9000→ OVERLOAD（碎裂特效+重啟按鈕）
LOCKED/SCANNING/RESULT ─臉消失>1s→ SEARCHING
```

啟動需使用者手勢（相機權限 + AudioContext 皆要求）。

## 視覺與音效

- 綠色單片鏡 HUD（貝吉塔款致敬）：全螢幕視訊、四角括號準心、七段顯示器風格數字、掃描線質感
- 手機直式全螢幕優先；提供前/後鏡頭切換鈕
- 音效全部 WebAudio 合成；視覺為原創致敬風格，不使用官方素材

## 錯誤處理

- 相機權限被拒 → 明確訊息 + 重試按鈕
- MediaPipe 模型/WASM 載入失敗 → 錯誤訊息 + 重試
- **Secure context 限制**：getUserMedia 需 HTTPS（localhost 除外）。手機連開發機 IP 測試需 `@vitejs/plugin-basic-ssl`

## 測試策略

- `power.ts` 全部純函式，Vitest 覆蓋：幾何 hash 的距離不變性與穩定性、加成曲線邊界（0 表情=×1、全力≈×10）、EMA 收斂、over-9000 判定
- 相機、偵測、HUD 走手動驗證：交付前實際在桌機（localhost）與手機（LAN HTTPS）跑過
