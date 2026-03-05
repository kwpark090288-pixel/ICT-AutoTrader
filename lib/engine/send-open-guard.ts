export type SendOpenRuntimeSnapshot = {
  syncing: boolean;
  dataOk: boolean;
  gapDetected: boolean;
  syncSource: string;
};

export function isSendOpenBlocked(snapshot: SendOpenRuntimeSnapshot): boolean {
  return snapshot.syncing || !snapshot.dataOk || snapshot.gapDetected;
}

export function getSendOpenBlockReason(snapshot: SendOpenRuntimeSnapshot): string {
  if (snapshot.syncing) {
    return `SYNCING_${snapshot.syncSource}`;
  }

  if (snapshot.gapDetected) {
    return "GAP_DETECTED";
  }

  if (!snapshot.dataOk) {
    return "DATA_NOT_OK";
  }

  return "NONE";
}
