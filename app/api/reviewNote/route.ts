import { NextRequest, NextResponse } from "next/server";
import {
  getPersistedReviewNote,
  upsertPersistedReviewNote,
} from "../../../lib/alerts/store";

type ReviewNoteApiResponse = {
  planId: string;
  reviewNoteText: string;
  reviewNoteUpdatedAtUtc: string | null;
};

type ReviewNotePostBody = {
  planId?: unknown;
  text?: unknown;
};

export async function GET(
  request: NextRequest
): Promise<NextResponse<ReviewNoteApiResponse>> {
  const planId = request.nextUrl.searchParams.get("planId") ?? "";

  const record = planId ? await getPersistedReviewNote(planId) : null;
  if (!record) {
    return NextResponse.json({
      planId,
      reviewNoteText: "",
      reviewNoteUpdatedAtUtc: null,
    });
  }

  return NextResponse.json(record);
}

export async function POST(
  request: NextRequest
): Promise<NextResponse> {
  let body: ReviewNotePostBody;

  try {
    body = (await request.json()) as ReviewNotePostBody;
  } catch {
    return NextResponse.json(
      { error: "invalid_json" },
      { status: 400 }
    );
  }

  const planId =
    typeof body.planId === "string" ? body.planId.trim() : "";
  if (!planId) {
    return NextResponse.json(
      { error: "planId_required" },
      { status: 400 }
    );
  }

  if (typeof body.text !== "string") {
    return NextResponse.json(
      { error: "text_must_be_string" },
      { status: 400 }
    );
  }

  const record = await upsertPersistedReviewNote(
    planId,
    body.text,
    new Date().toISOString()
  );

  return NextResponse.json(record);
}
