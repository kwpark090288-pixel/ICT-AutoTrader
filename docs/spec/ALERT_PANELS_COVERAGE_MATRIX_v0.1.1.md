# Alert Panels Coverage Matrix v0.1.1

이 문서는 DAY11 Alert Panels UI 구현 범위(113~122)에 대해
정본 규칙 ↔ 코드 위치 ↔ 현재 상태를 매핑한다.

## Status convention
- DONE: 코드 위치 / exact-match / build 확인 완료

| Row | Spec / Rule | Code location | Key symbols / functions | Status |
|---|---|---|---|---|
| UI-113 | SEND_OPEN / SEND_CLOSE 저장 + signals/reviewNote API | `lib/alerts/types.ts`; `lib/alerts/store.ts`; `app/api/signals/route.ts`; `app/api/reviewNote/route.ts` | `appendSignalEvent` / `listSignalEvents` / `getReviewNote` / `upsertReviewNote` | DONE |
| UI-114 | seen/unread 서버 영속화 + eventId=id + profileId=default | `lib/alerts/constants.ts`; `lib/alerts/types.ts`; `lib/alerts/store.ts`; `app/api/seen/route.ts`; `app/api/signals/route.ts` | `uiSeenState` / `upsertSeenState` / `listSignalEventsWithSeen` / `getSeenState` / `/api/seen` | DONE |
| UI-115 | muteKey(symbol, tf) 서버 영속화 + Mute 60m API | `lib/alerts/constants.ts`; `lib/alerts/types.ts`; `lib/alerts/store.ts`; `app/api/mute/route.ts`; `app/api/signals/route.ts` | `uiMuteState` / `buildMuteStateKey` / `buildMutedKeySet` / `upsertMuteState` / `/api/mute` | DONE |
| UI-116 | other inbox grouping `(symbol, tf, eventType, direction)` + 5분/3개 | `lib/alerts/constants.ts`; `lib/alerts/types.ts`; `lib/alerts/store.ts`; `app/api/signals/route.ts` | `buildSignalGroupKey` / `groupSignalEvents` / grouped `items` projection | DONE |
| UI-117 | HIGH sound policy + unseenHighCountOther wiring | `lib/alerts/constants.ts`; `lib/alerts/types.ts`; `lib/alerts/store.ts`; `lib/alerts/sound.ts`; `app/api/sound/route.ts`; `app/api/soundPlayed/route.ts` | `getAlertSeverity` / `shouldPlayHighOtherSymbolSound` / `markSoundPlayed` / `computeUnseenHighCountOther` | DONE |
| UI-118 | lower/right panel card data contracts | `lib/router/types.ts`; `lib/router/contracts.ts`; `lib/tradelifecycle/closeOutput.ts`; `lib/alerts/types.ts` | `RouterSendOpenPayload` / `RouterSendClosePayload` / `StoredSignalEvent` / `SignalFeedItem` | DONE |
| UI-119 | 카드 클릭 액션 race-lock contract | `lib/alerts/constants.ts`; `lib/alerts/types.ts`; `lib/alerts/navigation.ts` | `buildAlertCardNavigationPlan` / `buildOpenLinkPlan` / `findLinkedOpenEvent` | DONE |
| UI-120 | empty state / watchlist state line / error state contract | `lib/alerts/constants.ts`; `lib/alerts/types.ts`; `lib/alerts/status.ts` | `buildSelectedFeedStatusView` / `buildOtherInboxStatusView` / `buildWatchlistStatusLine` | DONE |
| UI-121 | top controls filters + deterministic projection order | `lib/alerts/constants.ts`; `lib/alerts/types.ts`; `lib/alerts/filters.ts`; `lib/alerts/store.ts`; `app/api/signals/route.ts` | `applySelectedFeedFilters` / `applyOtherInboxFilters` / `listSelectedSymbolEvents` / `listOtherInboxEvents` / `/api/signals` | DONE |
| UI-122 | coverage / integration smoke pack | `docs/spec/ALERT_PANELS_COVERAGE_MATRIX_v0.1.1.md`; `scripts/engine_exact_match.ts` | `selected feed` / `other inbox` / `grouping` / `mute` / `seen` / `click contract` / `state contract` | DONE |

## Notes
- UI는 raw engine 이벤트를 보여주지 않고 `SEND_OPEN` / `SEND_CLOSE`만 소비한다.
- selected feed는 flat, other inbox만 grouping 적용.
- seen은 서버 영속화, mute는 `(symbol, tf)` 기준.
