import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_ALERT_PROFILE_ID } from "../../../lib/alerts/constants";
import {
  getPersistedSoundPreference,
  upsertPersistedSoundPreference,
} from "../../../lib/alerts/store";

function normalizeProfileId(profileId?: string): string {
  if (typeof profileId === "string" && profileId.trim().length > 0) {
    return profileId;
  }

  return DEFAULT_ALERT_PROFILE_ID;
}

export async function GET(
  request: NextRequest
): Promise<NextResponse<{
  profileId: string;
  enabled: boolean;
  updatedAtUtc: string | null;
}>> {
  const profileId = normalizeProfileId(
    request.nextUrl.searchParams.get("profileId") ?? undefined
  );

  return NextResponse.json(await getPersistedSoundPreference(profileId));
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
  const enabled =
    typeof body === "object" && body !== null && "enabled" in body
      ? (body as { enabled?: unknown }).enabled
      : undefined;

  if (typeof enabled !== "boolean") {
    return NextResponse.json(
      { error: "enabled_required" },
      { status: 400 }
    );
  }

  return NextResponse.json(
    await upsertPersistedSoundPreference(profileId, enabled)
  );
}
