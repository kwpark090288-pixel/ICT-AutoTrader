import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_ALERT_PROFILE_ID } from "../../../lib/alerts/constants";
import {
  getPersistedSeenState,
  upsertPersistedSeenState,
} from "../../../lib/alerts/store";

type SeenGetResponse = {
  profileId: string;
  eventId: string;
  seenAtUtc: string | null;
  seen: boolean;
};

type SeenPostBody = {
  eventId?: unknown;
  profileId?: unknown;
  seenAtUtc?: unknown;
};

function normalizeProfileId(profileId: unknown): string {
  if (typeof profileId === "string" && profileId.trim().length > 0) {
    return profileId;
  }

  return DEFAULT_ALERT_PROFILE_ID;
}

export async function GET(
  request: NextRequest
): Promise<NextResponse> {
  const eventId = request.nextUrl.searchParams.get("eventId") ?? "";
  if (!eventId) {
    return NextResponse.json(
      { error: "eventId_required" },
      { status: 400 }
    );
  }

  const profileId = normalizeProfileId(
    request.nextUrl.searchParams.get("profileId")
  );
  const record = await getPersistedSeenState(profileId, eventId);

  if (!record) {
    return NextResponse.json({
      profileId,
      eventId,
      seenAtUtc: null,
      seen: false,
    } satisfies SeenGetResponse);
  }

  return NextResponse.json({
    profileId: record.profileId,
    eventId: record.eventId,
    seenAtUtc: record.seenAtUtc,
    seen: true,
  } satisfies SeenGetResponse);
}

export async function POST(
  request: NextRequest
): Promise<NextResponse> {
  let body: SeenPostBody;

  try {
    body = (await request.json()) as SeenPostBody;
  } catch {
    return NextResponse.json(
      { error: "invalid_json" },
      { status: 400 }
    );
  }

  const eventId =
    typeof body.eventId === "string" ? body.eventId.trim() : "";
  if (!eventId) {
    return NextResponse.json(
      { error: "eventId_required" },
      { status: 400 }
    );
  }

  const record = await upsertPersistedSeenState({
    profileId: normalizeProfileId(body.profileId),
    eventId,
    seenAtUtc:
      typeof body.seenAtUtc === "string" ? body.seenAtUtc : undefined,
  });

  return NextResponse.json(record);
}
