import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_ALERT_PROFILE_ID } from "../../../lib/alerts/constants";
import {
  getPersistedSoundPlayed,
  markPersistedSoundPlayed,
} from "../../../lib/alerts/store";

function normalizeProfileId(profileId?: string): string {
  if (typeof profileId === "string" && profileId.trim().length > 0) {
    return profileId;
  }

  return DEFAULT_ALERT_PROFILE_ID;
}

export async function GET(
  request: NextRequest
): Promise<NextResponse> {
  const eventId =
    request.nextUrl.searchParams.get("eventId") ?? undefined;
  const profileId = normalizeProfileId(
    request.nextUrl.searchParams.get("profileId") ?? undefined
  );

  if (!eventId) {
    return NextResponse.json(
      { error: "eventId_required" },
      { status: 400 }
    );
  }

  const record = await getPersistedSoundPlayed(profileId, eventId);

  return NextResponse.json({
    profileId,
    eventId,
    played: record !== null,
    playedAtUtc: record?.playedAtUtc ?? null,
  });
}

export async function POST(
  request: NextRequest
): Promise<NextResponse> {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_json" },
      { status: 400 }
    );
  }

  const profileId = normalizeProfileId(
    typeof body === "object" && body !== null && "profileId" in body
      ? (body as { profileId?: string }).profileId
      : undefined
  );
  const eventId =
    typeof body === "object" && body !== null && "eventId" in body
      ? (body as { eventId?: unknown }).eventId
      : undefined;

  if (typeof eventId !== "string" || eventId.length === 0) {
    return NextResponse.json(
      { error: "eventId_required" },
      { status: 400 }
    );
  }

  return NextResponse.json(
    await markPersistedSoundPlayed(profileId, eventId)
  );
}
