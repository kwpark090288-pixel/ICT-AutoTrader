import { normalizeChartTimeframe, type ChartTimeframe } from "@/lib/chart/timeframes";

export interface ChartTradePlanLinesArgs {
  entryRefPrice: number;
  stopPrice: number;
  tpPrice: number;
  durationMs: number;
}

export interface ChartController {
  symbol: string;
  tf: ChartTimeframe;
  isReady(): boolean;
  goToTime(centerTime: string, barsAround: number): void;
  showTradePlanLines(args: ChartTradePlanLinesArgs): void;
  highlightPOI(_poiRef: string, _durationMs: number): boolean;
}

type Waiter = {
  symbol: string;
  tf: ChartTimeframe;
  resolve: (controller: ChartController) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

let activeController: ChartController | null = null;
const waiters = new Set<Waiter>();

function maybeResolveWaiters(): void {
  if (!activeController || !activeController.isReady()) {
    return;
  }

  for (const waiter of [...waiters]) {
    if (
      activeController.symbol === waiter.symbol &&
      activeController.tf === waiter.tf
    ) {
      clearTimeout(waiter.timeoutId);
      waiters.delete(waiter);
      waiter.resolve(activeController);
    }
  }
}

export function registerChartController(controller: ChartController): void {
  activeController = controller;
  maybeResolveWaiters();
}

export function unregisterChartController(controller: ChartController): void {
  if (activeController === controller) {
    activeController = null;
  }
}

export function notifyChartControllerUpdated(): void {
  maybeResolveWaiters();
}

export async function whenChartControllerReady(args: {
  symbol: string;
  tf: string;
  timeoutMs?: number;
}): Promise<ChartController> {
  const symbol = args.symbol;
  const tf = normalizeChartTimeframe(args.tf);
  const timeoutMs = args.timeoutMs ?? 5000;

  if (
    activeController &&
    activeController.symbol === symbol &&
    activeController.tf === tf &&
    activeController.isReady()
  ) {
    return activeController;
  }

  return await new Promise<ChartController>((resolve, reject) => {
    const waiter = {} as Waiter;

    const timeoutId = setTimeout(() => {
      waiters.delete(waiter);
      reject(
        new Error(`Chart controller not ready for ${symbol} ${tf} within ${timeoutMs}ms`)
      );
    }, timeoutMs);

    waiter.symbol = symbol;
    waiter.tf = tf;
    waiter.resolve = resolve;
    waiter.reject = reject;
    waiter.timeoutId = timeoutId;

    waiters.add(waiter);
    maybeResolveWaiters();
  });
}
