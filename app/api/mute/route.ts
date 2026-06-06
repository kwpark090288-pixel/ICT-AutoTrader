import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_ALERT_PROFILE_ID,
  DEFAULT_MUTE_DURATION_MIN,
} from "../../../lib/alerts/constants";
import {
  clearPersistedMuteState,
  listPersistedActiveMuteStates,
  upsertPersistedMuteState,
} from "../../../lib/alerts/store";
import type { MuteQueryResult } from "../../../lib/alerts/types";

type MutePostBody = {
  profileId?: unknown;
  symbol?: unknown;
  tf?: unknown;
};

type MuteDeleteBody = {
  profileId?: unknown;
  symbol?: unknown;
  tf?: unknown;
};

function normalizeProfileId(profileId: unknown): string {
  if (typeof profileId === "string" && profileId.trim().length > 0) {
    return profileId;
  }

  return DEFAULT_ALERT_PROFILE_ID;
}

function addMinutesUtcIso(
  nowUtc: string,
  minutes: number
): string {
  return new Date(Date.parse(nowUtc) + minutes * 60 * 1000).toISOString();
}

export async function GET(
  request: NextRequest
): Promise<NextResponse<MuteQueryResult>> {
  const profileId = normalizeProfileId(
    request.nextUrl.searchParams.get("profileId")
  );
  const nowUtc = new Date().toISOString();

  return NextResponse.json({
    items: await listPersistedActiveMuteStates(profileId, nowUtc),
  });
}

export async function POST(
  request: NextRequest
): Promise<NextResponse> {
  let body: MutePostBody;

  try {
    body = (await request.json()) as MutePostBody;
  } catch {
    return NextResponse.json(
      { error: "invalid_json" },
      { status: 400 }
    );
  }

  const symbol =
    typeof body.symbol === "string" ? body.symbol.trim() : "";
  const tf = typeof body.tf === "string" ? body.tf.trim() : "";

  if (!symbol || !tf) {
    return NextResponse.json(
      { error: "symbol_tf_required" },
      { status: 400 }
    );
  }

  const nowUtc = new Date().toISOString();
  const profileId = normalizeProfileId(body.profileId);
  const record = await upsertPersistedMuteState({
    profileId,
    symbol,
    tf,
    muteUntilUtc: addMinutesUtcIso(nowUtc, DEFAULT_MUTE_DURATION_MIN),
  });

  return NextResponse.json(record);
}

export async function DELETE(
  request: NextRequest
): Promise<NextResponse> {
  let body: MuteDeleteBody = {};

  if (request.headers.get("content-type")?.includes("application/json")) {
    try {
      body = (await request.json()) as MuteDeleteBody;
    } catch {
      body = {};
    }
  }

  const symbol =
    (typeof body.symbol === "string" ? body.symbol : null) ??
    request.nextUrl.searchParams.get("symbol") ??
    "";
  const tf =
    (typeof body.tf === "string" ? body.tf : null) ??
    request.nextUrl.searchParams.get("tf") ??
    "";

  if (!symbol || !tf) {
    return NextResponse.json(
      { error: "symbol_tf_required" },
      { status: 400 }
    );
  }

  const profileId = normalizeProfileId(
    body.profileId ?? request.nextUrl.searchParams.get("profileId")
  );

  await clearPersistedMuteState(profileId, symbol, tf);

  return NextResponse.json({ ok: true });
}
