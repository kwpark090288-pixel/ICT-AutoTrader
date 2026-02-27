# SPEC_MANIFEST (Pinned)

## Source of Truth
- PDFs in this folder are the Source of Truth (SoT). No rewriting / reinterpretation.
- DAY_PLAN_v3.2.1.txt is SoT for execution order (1~100).
- ROUTER_TELEGRAM_OUTBOX_SPEC_v0.1.0.md is SoT for telegram outbox.

## Pinned Specs (SHA256)
| Spec | Version | File | SHA256 |
|---|---|---|---|
| FVG | v1.1.2 | FVG v1.1.2 2026-02-13.pdf | 22ccbd4df5d960b54cb689e0a7a77aad4c08c5fcf5bc77d4f53607af793f8c63 |
| OB | v1.2.1 | OB v1.2.1 2026-02-07 (1).pdf | 28658939c4e5441f12b8b4ee444d614d03445bc39b2dfef0b886cc0a2a899dde |
| CHANNEL | v1.2.1 | CHANNEL_v1.2.1_Spec_Block1_2_3_readable_layout_v2 (2).pdf | a176adc92edc28e68ca9091cae9959a6c5f3ac74a326afd57856eed08c482f99 |
| TRENDLINE | v1.2.1 | TRENDLINE v1.2.1 2026-02-07 (1).pdf | e9f4b10938a7dbca493feef7d7327d0f111b2a4d620b8a6e30ba34ef0bc6b715 |
| POLICY (combined) | v1.1.2 + ADDENDUM(2026-02-25) | POLICY_LAYER_v1.1.2_ADDENDUM_2026-02-25.pdf | b5ec963ba63ab3e2eeefdcaad1a8dcc443090f2598f3dff85e85bd813bf6ae77 |
| TRADE_LIFECYCLE | v0.1.5 + ADDENDUM(2026-02-25) | TRADE_LIFECYCLE_v0.1.5_Blocks1-3_2026-02-24_ADDENDUM_2026-02-25.pdf | 6fdffc114d71c96fef42d2e0e78c13be64f6d1b21a20fb0edb439c9cad985ec6 |
| UI_SPEC | v0.1.1 | ALERT_PANELS_UI_SPEC_v0.1.1 (1).pdf | edf064f52ba05de69843dcecf159338e3cc2af86f62e898a79c992fdce6ca0a6 |

## operationalParams (Pinned)
- TF_SET = D1,H4,H1,M30,M15,M5
- D1 dayKey 기준 = UTC 00:00

- insideOverlapRatio = 0.20
- stackOverlapRatio = 0.30
- cooldownAfter15mReactionMin = 30
- cooldownAfter5mEntryMin = 60

- MAX_FORWARD_BARS = 300
- MIN_ZONE_HEIGHT_ATR = 0.15
- PENETRATION_ATR = 0.10
- PENETRATION_ZONE = 0.25
- LTF_GATE_ATR = 0.20

- preload/backfill lookback (candles per symbol×TF):
  - D1: 400
  - H4: 600
  - H1: 1000
  - M30: 1200
  - M15: 1500
  - M5: 3000