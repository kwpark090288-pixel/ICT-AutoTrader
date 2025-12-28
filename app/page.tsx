"use client";

import { useEffect, useRef, useState } from "react";
import CandleChart from "./components/CandleChart";

function clamp(n: number, min: number, max: number) {
  return Math.min(Math.max(n, min), max);
}

export default function Page() {
  const [selectedTf, setSelectedTf] = useState("4H");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const tfs = ["3m", "5m", "15m", "30m", "1H", "2H", "4H"];

  // ✅ 리사이즈 래퍼(좌/우 전체를 감싸는 div)
  const splitWrapRef = useRef<HTMLDivElement | null>(null);

  // ✅ 드래그 상태
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startWRef = useRef(0);

  // ✅ 왼쪽(차트) 패널 폭(px)
  const [leftW, setLeftW] = useState(920);

  // ✅ 드래그 시작 (핸들에서만 호출)
  const onDown = (e: React.MouseEvent<HTMLDivElement>) => {
    draggingRef.current = true;
    startXRef.current = e.clientX;
    startWRef.current = leftW;
    e.preventDefault();

    // 텍스트 선택 방지
    document.body.style.userSelect = "none";
  };

  // ✅ 드래그 이동/종료: window 이벤트 1번만 붙이기
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;

      const wrap = splitWrapRef.current;
      if (!wrap) return;

      const dx = e.clientX - startXRef.current;

      // 래퍼 전체 폭 기준으로 왼쪽 최대 폭 제한(오른쪽 최소폭 확보)
      const rect = wrap.getBoundingClientRect();
      const wrapW = rect.width;

      const MIN_LEFT = 520;
      const RIGHT_MIN = 360;
      const HANDLE_W = 12; // w-3 = 12px
const GAP = 16; // gap-4 = 16px (좌-핸들, 핸들-우 2번)

const maxLeft = Math.max(
  MIN_LEFT,
  wrapW - RIGHT_MIN - HANDLE_W - 2 * GAP
);

      const next = clamp(startWRef.current + dx, MIN_LEFT, maxLeft);

      setLeftW(next);
    };

    const onUp = () => {
      if (!draggingRef.current) return;
      draggingRef.current = false;
      document.body.style.userSelect = "";
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.userSelect = "";
    };
  }, []); // ✅ 여기 절대 [leftW] 넣지 마!

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* 상단바 */}
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded bg-zinc-800" />
            <div className="text-lg font-semibold">트레이딩 대시보드</div>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm"
            >
              <option value="BTCUSDT">BTCUSDT</option>
              <option value="ETHUSDT">ETHUSDT</option>
              <option value="SOLUSDT">SOLUSDT</option>
            </select>

            <select
              value={selectedTf}
              onChange={(e) => setSelectedTf(e.target.value)}
              className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm"
            >
              {tfs.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <button className="rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm">
              설정
            </button>
            <button className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium">
              알림
            </button>
          </div>
        </div>
      </header>

      {/* 본문 */}
      <main className="w-full px-4 py-4">
        {/* ✅ 좌/우를 flex로 묶는 “틀” */}
        <div ref={splitWrapRef} className="flex flex-col gap-4 lg:flex-row">
          {/* LEFT: 차트 */}
          <section
  className="min-w-0 rounded-xl border border-zinc-800 bg-zinc-950 p-3"
  style={{ flexBasis: leftW, flexShrink: 0 }}
>

            {/* ✅ 차트 헤더 */}
            <div className="mb-2 flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">
                  {symbol} · {selectedTf}
                </div>
                <div className="text-xs text-zinc-400">LIVE</div>
              </div>
              <div className="text-xs text-zinc-500">자동 갱신: 15초</div>
            </div>

            {/* ✅ 차트 */}
            <div className="rounded-lg border border-zinc-800 bg-zinc-950">
              <CandleChart symbol={symbol} tf={selectedTf} />
            </div>

            {/* ✅ 타임프레임 버튼 */}
            <div className="mt-3 flex flex-wrap gap-2">
              {tfs.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSelectedTf(t)}
                  className={`rounded-md border px-3 py-2 text-sm ${
                    selectedTf === t
                      ? "border-emerald-500 bg-emerald-500/10 text-emerald-200"
                      : "border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </section>

          {/* HANDLE (lg에서만 보이게) */}
          <div
  onMouseDown={onDown}
  className="w-3 cursor-col-resize rounded bg-zinc-800/20 hover:bg-zinc-700/50 active:bg-zinc-600/50"
  title="드래그해서 크기 조절"
/>
          {/* RIGHT: 패널 */}
          <section className="min-w-[360px] min-w-0 flex-1 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold">최근 시그널</div>
              <button className="text-xs text-zinc-400 hover:text-zinc-200">
                …
              </button>
            </div>

            {/* ✅ 일단 예시 카드 (나중에 너의 실제 신호 리스트로 교체) */}
            <div className="space-y-3">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <div className="text-xs text-zinc-400">BTCUSDT · 4H</div>
                <div className="mt-1 text-sm font-semibold">
                  Bullish OB ·{" "}
                  <span className="text-emerald-400">Score 91 (A+)</span>
                </div>
                <div className="mt-1 text-sm text-zinc-300">
                  채널 하단 + 스윕 + HTF 디스카운트
                </div>
                <div className="mt-2 inline-flex rounded bg-emerald-600/20 px-2 py-1 text-xs text-emerald-200">
                  SUPER SETUP
                </div>
              </div>

              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <div className="text-xs text-zinc-400">ETHUSDT · 1H</div>
                <div className="mt-1 text-sm font-semibold">
                  Bearish OB ·{" "}
                  <span className="text-emerald-400">Score 85 (A)</span>
                </div>
                <div className="mt-1 text-sm text-zinc-300">
                  추세선 리젝션 + HTF 존
                </div>
              </div>
            </div>

            <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-400">
              다음 단계: 실데이터(캔들) 연결 → OB/FVG 박스 오버레이 → 알림(텔레그램)
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
