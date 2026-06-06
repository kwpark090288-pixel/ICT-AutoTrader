# FVG Coverage Matrix v1.1.2

??臾몄꽌??DAY4~DAY6 FVG 援ы쁽 踰붿쐞(37~60)??????뺣낯 洹쒖튃 ??肄붾뱶 ?꾩튂 ???꾩옱 ?곹깭瑜?留ㅽ븨?쒕떎.

## Status convention
- DONE: 肄붾뱶 ?꾩튂 ?뺤씤 ?꾨즺
- TODO: ?꾩쭅 誘멸뎄??/ ?ㅼ쓬 ?④퀎

| Row | Spec / Rule | Code location | Key symbols / functions | Status |
|---|---|---|---|---|
| FVG-37 | ?곸닔 / enum / state / ?곗씠?곕え?????| `lib/engine/indicators/fvg/constants.ts` / `lib/engine/indicators/fvg/types.ts` | `FVG_TFS`, `FVG_BOX_TYPES`, `FVG_H4_CORE_STATES`, `DetectedWickFvg`, `D1PoiFvg`, `H4CoreFvg`, `SetupFvg`, `StackZone` | DONE |
| FVG-38 | 3罹붾뱾 wick FVG ?먯? + conf ?쒖젏(i+1 close) ?뺤젙 | `lib/engine/indicators/fvg/engine.ts` | `isFvgDetectTf`, `buildDetectedWickFvg`, `detectConfirmedWickFvgFromRecentBars` | DONE |
| FVG-39 | TF蹂?ATR14 + conf ?쒖젏 ATR ?섑뵆留?| `lib/engine/indicators/fvg/atr.ts` / `lib/engine/indicators/fvg/engine.ts` | `computeTrueRange`, `buildAtr14Snapshots`, `getAtrSnapshotAtConfTime`, `getAtrValueAtConfTime`, `detectConfirmedWickFvgWithAtrFromTfBars` | DONE |
| FVG-40 | pivotLen=3 fractal pivot + p+3 close ?뺤젙留??ъ슜 | `lib/engine/indicators/fvg/pivots.ts` | `isPivotStructureTf`, `detectConfirmedFractalPivotAtIndex`, `detectNewlyConfirmedFractalPivot` | DONE |
| FVG-41 | D1/H4 援ъ“?곹깭(UP/DOWN/MIXED) + BOS/CHOCH close break | `lib/engine/indicators/fvg/constants.ts` / `lib/engine/indicators/fvg/types.ts` / `lib/engine/indicators/fvg/structure.ts` | `FVG_STRUCTURE_BREAK_TYPES`, `StructureBreakType`, `StructureEvalResult`, `evaluateStructureAtClose` | DONE |
| FVG-42 | 蹂??Displacement) F1 洹쒖튃 | `lib/engine/indicators/fvg/displacement.ts` | `DisplacementEvalResult`, `getCandleBodySize`, `evaluateDisplacementF1FromRecentBars`, `evaluateDisplacementF1FromTfBars` | DONE |
| FVG-43 | Sweep -> Recovery (EQH/EQL outer-line + fallback + next close / conf-3~conf+2) | `lib/engine/indicators/fvg/sweep-recovery.ts` | `resolveSweepRecoveryTarget`, `evaluateSweepRecoveryFromTfBars` | DONE |
| FVG-44 | F4 而⑦뀓?ㅽ듃 ?곕룞 ?명꽣?섏씠??(provider ?놁쑝硫?false) | `lib/engine/indicators/fvg/context.ts` | `F4ContextSource`, `F4ContextInput`, `F4ContextEvalResult`, `F4ContextProvider`, `evaluateF4Context` | DONE |
| FVG-45 | D1_POI_FVG ?깅줉/臾댄슚??helper | `lib/engine/indicators/fvg/d1-poi.ts` | `D1MixedStrongDisplacementEvalResult`, `D1PoiRegistrationEvalResult`, `D1PoiInvalidationFlags`, `evaluateD1MixedStrongDisplacementFromRecentBars`, `evaluateD1PoiFvgRegistration`, `evaluateD1PoiFvgInvalidationFlags` | DONE |
| FVG-46 | H4 CANDIDATE ?앹꽦 | `lib/engine/indicators/fvg/h4-core.ts` | `getH4CoreConfirmDueTime`, `getH4CoreDisplayUntil`, `createH4CoreFvgCandidate` | DONE |
| FVG-47 | H4 conf+3 close?먯꽌 A ?먯젙 / ?밴꺽 / ??젣 | `lib/engine/indicators/fvg/h4-confirm.ts` | `H4CandidateConfirmEvalResult`, `countH4SecondaryPasses`, `evaluateH4CoreFvgCandidateConfirm`, `applyH4CoreFvgCandidateConfirm` | DONE |
| FVG-48 | Full fill / Opposite CHOCH / Touch3 / Prune 臾댄슚???곗꽑?쒖쐞 | `lib/engine/indicators/fvg/invalidation.ts` | `FvgInvalidationFlags`, `FvgInvalidationDecision`, `resolveFvgInvalidationReasonWithPriority`, `resolveFvgInvalidationDecision` | DONE |
| FVG-49 | ?곗튂 移⑦닾?꾪꽣 (`overlapLen >= max(ATR*0.10, zoneHeight*0.25)`) | `lib/engine/indicators/fvg/touch-filter.ts` | `TouchPenetrationEvalResult`, `computeTouchOverlapLen`, `computeTouchPenetrationMin`, `evaluateTouchPenetrationFilter` | DONE |
| FVG-50 | H1/M30 SETUP_FVG (inside 0.20 + 諛⑺뼢 ?뺥빀 + 蹂???꾩닔) | `lib/engine/indicators/fvg/setup.ts` | `isSetupTf`, `isEligibleSetupParentPoi`, `computeInsideOverlapLen`, `computeInsideOverlapRatio`, `getSetupDisplayUntil`, `createSetupFvg` | DONE |
| FVG-51 | STACK (0.30 overlap) + 異쒕젰 ?곗꽑?쒖쐞 | `lib/engine/indicators/fvg/stack.ts` | `computeStackOverlapLen`, `computeStackOverlapRatio`, `getStackTfForPair`, `getStackDisplayUntil`, `createStackZoneFromPair`, `createStackZonesInPriorityOrder` | DONE |
| FVG-52 | LTF gate (`ATR*0.20`, boundary 怨좎젙) | `lib/engine/indicators/fvg/ltf-gate.ts` | `LtfGateEvalResult`, `isLtfReactionTf`, `isEligibleLtfGatePoi`, `getLtfGateBoundary`, `getLtfGatePriceExtreme`, `computeLtfGateDist`, `evaluateLtfGateOnBar`, `evaluateLtfGateFromTfBars` | DONE |
| FVG-53 | LTF trigger 3醫?(SWEEP_REC / CHOCH / microRetest 3醫? | `lib/engine/indicators/fvg/ltf-triggers.ts` | `detectConfirmedMicroPivotAtIndex`, `getLatestConfirmedMicroPivot`, `resolveLtfSweepRecoveryTarget`, `evaluateLtfChochTrigger`, `evaluateLtfSweepRecTrigger`, `evaluateMicroRetestBoundaryTrigger`, `evaluateMicroRetestMicroObTrigger`, `evaluateMicroRetestMicroFvgTrigger`, `sortUniqueLtfTriggerTokens`, `evaluateLtfTriggers` | DONE |
| FVG-54 | cooldown 30/60 (REACTION vs ENTRY) | `lib/engine/indicators/fvg/reaction-gate.ts` | `ReactionGateEvalResult`, `buildReactionGateKey`, `createReactionGate`, `getBlock5mUntilFrom15mReaction`, `getBlockAllUntilFrom5mEntry`, `apply15mReactionToGate`, `apply5mEntryToGate`, `evaluateReactionGate` | DONE |
| FVG-55 | pruning(?쒖꽦 媛쒖닔 ?쒗븳) + ?ㅻ옒??寃?鍮꾪솢??泥섎━ | `lib/engine/indicators/fvg/prune.ts` | `FvgPruneBucket`, `getFvgPruneBucket`, `getFvgPruneLimit`, `buildFvgPruneIdSet`, `applyFvgPrune` | DONE |
| FVG-56 | tick ?뺢퇋??/ ID / 異쒕젰 ?щ㎎ | `lib/engine/indicators/fvg/normalize.ts` | `TickNormalizedZone`, `normalizeFvgZoneToTick`, `formatTickNormalizedPrice`, `formatFvgZoneForOutput`, `buildNormalizedFvgId`, `formatRatio2` | DONE |
| FVG-57 | 而ㅻ쾭由ъ? 留ㅽ듃由?뒪 ?묒꽦(????肄붾뱶 ?꾩튂 留ㅽ븨) | `docs/spec/FVG_COVERAGE_MATRIX_v1.1.2.md` | ??臾몄꽌 ?먯껜 | DONE |
| FVG-58 | ?쒕??뺤젙 pivot ?ъ슜 湲덉????뚯뒪??異붽? | `scripts/engine_exact_match.ts` | `fvg unconfirmed pivot is unavailable before p+3 close`, `fvg ltf unconfirmed micro pivot high is not usable`, `fvg ltf choch ignores unconfirmed micro pivot high`, `fvg ltf sweep target ignores unconfirmed eq pair` | DONE |
| FVG-59 | ?쐁onf+3 close ?먯젙/??젣 ??대컢???뚯뒪??異붽? | `scripts/engine_exact_match.ts` | `fvg h4 confirm timing only due bar can pass`, `fvg h4 confirm timing does not pass after due bar`, `fvg h4 confirm timing does not delete before due bar`, `fvg h4 confirm timing does not late-promote after due bar`, `fvg h4 confirm timing does not late-delete after due bar` | DONE |
| FVG-60 | LTF REACTION/ENTRY + cooldown + pruning 통합 테스트 | `scripts/engine_exact_match.ts` | `fvg integrated m15 reaction passes with gate and trigger`, `fvg integrated m5 entry passes with gate and trigger`, `fvg integrated 15m reaction blocks m5 entry during cooldown`, `fvg integrated m5 entry resumes after 15m cooldown expiry`, `fvg integrated 5m entry blocks m15 reaction during cooldown`, `fvg integrated pruned poi cannot trigger reaction`, `fvg integrated non-pruned poi can still trigger reaction`, `fvg integrated inactive poi cannot trigger entry` | DONE |

## Notes
- 紐⑤뱺 exact-match ?뚯뒪?몄쓽 湲곗? ?뚯씪? `scripts/engine_exact_match.ts`
- ?꾩옱 exact-match ?꾩쟻 cases ?섎뒗 DAY4-56源뚯? 諛섏쁺???곹깭瑜?湲곗??쇰줈 吏꾪뻾 以?- FVG-58 ~ FVG-60? ?꾩쭅 TODO ?곹깭?대ŉ ?ㅼ쓬 ?④퀎?먯꽌 媛깆떊?쒕떎
