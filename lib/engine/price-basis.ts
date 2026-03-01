export const CHART_DISPLAY_PRICE_SOURCE = "UI_CHART_DISPLAY_ONLY";
export const POLICY_MARKET_PRICE_SOURCE = "LAST_PRICE";
export const POLICY_DERIVED_CANDLE_SOURCE = "LAST_PRICE_KLINE";

export const TRADE_LIFECYCLE_EVAL_TF = "M5";
export const TRADE_LIFECYCLE_BAR_SOURCE = "BINANCE_USDM_FUTURES_STANDARD_KLINE_LAST";

export const MARK_PRICE_ENABLED = false;
export const INDEX_PRICE_ENABLED = false;

export function dumpPriceBasisLock() {
  return {
    chartDisplayPriceSource: CHART_DISPLAY_PRICE_SOURCE,
    policyMarketPriceSource: POLICY_MARKET_PRICE_SOURCE,
    policyDerivedCandleSource: POLICY_DERIVED_CANDLE_SOURCE,
    tradeLifecycleEvalTf: TRADE_LIFECYCLE_EVAL_TF,
    tradeLifecycleBarSource: TRADE_LIFECYCLE_BAR_SOURCE,
    markPriceEnabled: MARK_PRICE_ENABLED,
    indexPriceEnabled: INDEX_PRICE_ENABLED,
  };
}
