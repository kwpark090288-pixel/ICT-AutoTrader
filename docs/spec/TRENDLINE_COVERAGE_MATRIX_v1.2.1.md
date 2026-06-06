# Trendline Coverage Matrix v1.2.1

이 문서는 DAY10 TRENDLINE 구현 범위(85~94)에 대해
정본 규칙 ↔ 코드 위치 ↔ 현재 상태를 매핑한다.

## Status convention
- DONE: 코드 위치 확인 완료

| Row | Spec / Rule | Code location | Key symbols / functions | Status |
|---|---|---|---|---|
| TL-85 | 상수 / enum / 데이터모델 타입 | `lib/engine/indicators/trendline/constants.ts` / `lib/engine/indicators/trendline/types.ts` | `TRENDLINE_TFS`, `TRENDLINE_MODEL_TFS`, `TRENDLINE_REACTION_TFS`, `TRENDLINE_TYPES`, `LINE_STATES`, `TRENDLINE_INVALID_REASONS`, `Pivot`, `AtrSnapshot`, `StructureSnapshot`, `BestMatch`, `RoleFlipWatch`, `Trendline` | DONE |
| TL-86 | pivotLen=3 fractal pivot + p+3 close 확정 | `lib/engine/indicators/trendline/pivots.ts` | `TRENDLINE_PIVOT_LEN`, `isTrendlinePivotTf`, `detectConfirmedTrendlinePivotAtIndex`, `detectNewlyConfirmedTrendlinePivot`, `appendTrendlinePivotKeepingLast3` | DONE |
| TL-87 | 최근 HIGH 3개 / LOW 3개로 구조상태(UP/DOWN/MIXED) | `lib/engine/indicators/trendline/structure.ts` | `isTrendlineStructureTf`, `takeLatestConfirmedTrendlinePivots`, `evaluateTrendlineStructureState`, `buildTrendlineStructureSnapshot` | DONE |
| TL-88 | detectOrUpdate용 앵커 선택 + minSwing + line 생성 | `lib/engine/indicators/trendline/detect.ts` | `isTrendlineDetectTf`, `getTrendlineLookbackBars`, `getTrendlineMinSwingAtrMultiplier`, `getTrendlineMaxForwardBars`, `getTrendlineDisplayUntil`, `checkTrendlineMinSwing`, `selectAnchorsWithinLookback`, `createTrendlineFromAnchors`, `detectTrendlineCandidates` | DONE |
| TL-89 | touch / break / stale_expired helper | `lib/engine/indicators/trendline/lifecycle.ts` | `evaluateTrendlineTouchAtBar`, `evaluateTrendlineBreakAtBar`, `evaluateTrendlineStaleExpiration`, `applyTrendlineTouchAndBreakStats`, `applyTrendlineLifecycleInvalidation` | DONE |
| TL-90 | role flip watch / confirm helper | `lib/engine/indicators/trendline/role-flip.ts` | `getTrendlineRoleFlipOppositeType`, `shouldStartTrendlineRoleFlipWatch`, `evaluateTrendlineRoleFlipOppositeClose`, `applyTrendlineRoleFlip` | DONE |
| TL-91 | TL∩POI / TL∩Channel collab + bestMatch | `lib/engine/indicators/trendline/collab.ts` | `getTrendlineIntentDir`, `computeTrendlineDistanceToZone`, `computeTrendlineCollabDistanceTicks`, `getTrendlinePoiCollabTag`, `getTrendlineChannelCollabTag`, `computeTrendlineChannelDistance`, `evaluateTrendlineCollab` | DONE |
| TL-92 | LTF reaction triggers | `lib/engine/indicators/trendline/ltf.ts` | `isTrendlineReactionTf`, `detectConfirmedTrendlineMicroPivotAtIndex`, `getLatestConfirmedTrendlineMicroPivot`, `evaluateTrendlineLtfChochTrigger`, `evaluateTrendlineSweepRecTriggerNow`, `evaluateTrendlineMicroObRetestTrigger`, `evaluateTrendlineMicroFvgRetestTrigger`, `sortUniqueTrendlineLtfTriggerTokens`, `evaluateTrendlineLtfTriggers`, `evaluateTrendlineLtfTriggersFromTfBars` | DONE |
| TL-93 | 이벤트 문자열 / emit helper | `lib/engine/indicators/trendline/events.ts` | `formatTrendlineNewEvent`, `resolveTrendlineNewEvent`, `formatTrendlineTouchEvent`, `resolveTrendlineTouchEvent`, `formatTrendlineRoleFlipEvent`, `resolveTrendlineRoleFlipEvent`, `formatTrendlineInvalidEvent`, `resolveTrendlineInvalidEvent`, `formatTrendlinePoiCandidateEvent`, `resolveTrendlinePoiCandidateEvent` | DONE |
| TL-94 | coverage / integration test pack | `docs/spec/TRENDLINE_COVERAGE_MATRIX_v1.2.1.md` / `scripts/engine_exact_match.ts` | `trendline integration detect to new event works`, `trendline integration touch stats emit touch event`, `trendline integration role flip emits event`, `trendline integration break invalidation emits invalid event`, `trendline integration collab pipeline returns tags and bestMatch`, `trendline integration ltf pipeline returns sorted triggers`, `trendline integration poi candidate first emit works` | DONE |

## Notes
- 모든 exact-match 테스트의 기준 파일은 `scripts/engine_exact_match.ts`
- TRENDLINE 구간의 coverage/test pack 마감 시점은 TL-94 기준으로 본다

저장: Ctrl + S
