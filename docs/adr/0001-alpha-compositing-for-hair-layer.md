# 3D 髮層合成從 mix-blend-mode: screen 改為 alpha 合成

screen blend 是當初刻意選的(迴避 UnrealBloom 在透明背景上的黑邊、又剛好符合「能量髮只加亮」),但它在數學上不可能變暗(`1-(1-a)(1-b) ≥ max(a,b)`),而賽亞人頭髮的終局目標裡有兩件事需要變暗:正統賽璐璐的暗部色階與描邊(M1)、染金/遮蓋使用者真髮(M3)。因此決定在 M1 就把髮體改為 alpha 合成,screen blend 只保留給光暈,一次到位、避免材質調兩輪。

Status: accepted

## Considered Options

- **留 screen blend,走「亮域賽璐璐」**(把 cel 色階壓進只加亮的色域):M1 最省,但 M3 反正非換不可,且暗部/描邊永遠做不出來——被否決。
- **雙 canvas**(髮體 alpha 一層、bloom 光暈 screen 一層):可行的退路,但多一個 WebGL context 的行動裝置成本。實作上以單 context(shader 內合成 bloom)優先,驗證失敗才退到這個方案。

## Consequences

- bloom 黑邊問題需要在 alpha 管線下重新解一次(當初 screen blend 正是為了繞開它)。
- CLAUDE.md 的不變量「這層只能加亮,永遠不要依賴它變暗」在 M1 落地時過時,必須同步改寫。
- 效能硬線:實測手機、變身中 ≥30fps(`?debug` 驗收)——alpha 合成+描邊(inverted hull)是新增成本的主要來源。
