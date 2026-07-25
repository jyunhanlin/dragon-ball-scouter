# 三層金色各自持有旋鈕,不設共用金色常數

T9(#10)要求真髮染金與髮束賽璐璐金「讀起來是同一頭金髮」,最直覺的做法是抽一個共用 palette 讓兩層共用同一組 RGB。但三個金色不在同一個色彩空間:`hud.ts` 的 `GOLD` 是 2D canvas `fillStyle`,直出 sRGB;`tint.ts` 的 `TINT_SHADOW_GOLD`/`TINT_HIGHLIGHT_GOLD` 由亮度在 sRGB byte 空間 mix 後直出;`hair3d.ts` 的 `CEL_GOLD` 會被 three 轉進線性工作空間、乘光照與**量化**的 3 階色帶、加 emissive 與 bloom,最後才在 composite 以 `pow(1/2.2)` 編回 sRGB。`#ffd75e` 在 hud 與 hair3d 各出現一次、tint 是差一點的近似值 —— 那是巧合而非對齊:同一組 RGB 在三層是三種螢幕顏色。因此決定不設共用常數,各層維持自己的旋鈕,金色一致性以兩層並排、對造型基準實機仲裁。

Status: accepted

## Considered Options

- **共用 palette 葉模組**(否決):看似單一真實來源,實際會讓 source 統一而螢幕依然不 match —— 假的單一真實來源,比三份分散的常數更危險,因為它讓人以為問題已經解決。附帶代價是破例新增第三個 sanctioned value import(見 CLAUDE.md「Architecture」的葉模組規則)。
- **從 hair3d 的著色鏈反解出對齊 tint 的數值**(否決):中間卡著量化色帶與 bloom,不可解析地反解;即使數值解得出來,每次動光照或色帶都要重算,等於把調色綁死在渲染管線上——正是 #10 的「調整金色不需動管線」要避免的。
- **各層獨立旋鈕 + 實機並排仲裁**(採用):旋鈕全部匯出在各自檔案頂部,仲裁交給眼睛與造型基準。

## Consequences

- 調金色必須同時看見兩層,不能只改一個常數 —— `?tint` 因此擴充為同時渲染染金與髮束(未變身、同一張真臉),否則每調一次都要吼到變身。
- 三處金色漂移的風險由 CLAUDE.md 的跨檔案不變量與本 ADR 承接,型別系統擋不住;新增第四處金色時必須回來讀這條。
- `hud.ts` 的 `GOLD` 是 HUD 主題色、與頭髮無關,與 `CEL_GOLD` 共用 `#ffd75e` 純屬巧合,不應被誤讀為耦合而「順手統一」。
- 本 ADR 的理由建立在**色帶是量化的**。若日後 hair3d 改走連續著色,反解可能重新變得可行,屆時應重審。
