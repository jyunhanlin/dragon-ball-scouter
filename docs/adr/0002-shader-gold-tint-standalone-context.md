# 染金改走獨立 WebGL context 的 shader 保光染色

T8 的染金(復刻舊 2D 管線:categoryMask 硬遮罩 + sepia 濾鏡鏈)實機檢視有兩個痕點:金色像貼紙(sepia 把髮絲明暗壓成單一色調)、髮際線硬邊(二值遮罩)。目標定為 IG 染髮濾鏡質感(grill 定案;蓋髮/金髮盔方案維持否決,見 CONTEXT.md「染金」條目)。決定把染色搬進 fragment shader:confidenceMasks + smoothstep 軟遮罩、亮度驅動 shadowGold→highlightGold 雙色 ramp,由 tint.ts 內部以離屏 canvas 自開獨立輕量 raw WebGL context(不引 three.js;`#tint` 已持有 2D context,同一 canvas 拿不到第二種 context——shader 輸出仍是 video 像素空間圖層,與 2D 降級共用同一條顯示路徑,main.ts 無感)。這是 #1 預留的「video 需要進 texture」管線改動的落地。

Status: accepted

## Considered Options

- **canvas `'color'` blend(留在 2D)**:零逐像素 JS、既有機制,但信心值軟遮罩仍需 CPU float 迴圈,且高光 rolloff、雙色 ramp、未來的時間 EMA 都做不進去——天花板低於目標,被否決。
- **併進 hair3d 場景(單 context)**:tint 當背景 quad 在髮束前繪製。守住單 context,但 tint 搬進 three.js lazy chunk(SKIP 與 garnish 綁死)、碰 M1/M2 的 render 道路、video 每幀進 hair3d texture——blast radius 過大,被否決。
- **獨立輕量 context(採用)**:全底 quad + 一張 fragment shader,約百行。hair3d 零改動,tint.ts 維持葉模組。

## Consequences

- 頁面出現第二個 WebGL context。ADR-0001 曾以「多一個 context 的行動裝置成本」否決雙 canvas——該處指 hair3d 內部 bloom 鏈的全尺寸選項;本 ADR 接受的是「單 quad、無深度、小 shader」的輕量 context,成本級距不同。手機 context 初始化失敗/遺失的風險非零:降級回 T8 的 2D 染色(降級路徑保留,boot SKIP 語意不變)。
- 調色旋鈕從 CSS 濾鏡字串遷移為 shader uniform(仍由 tint.ts 頂部匯出常數餵入);T9(#10)的金色調校在遷移後才有意義——#10 改 blocked by #11。
- 時間穩定(前幀 mask EMA)在 shader 留接縫;是否實作等軟遮罩+保光染色實機檢視後另議。
