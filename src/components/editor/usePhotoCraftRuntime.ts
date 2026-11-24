import { useEffect, useRef, useState } from "react";
import type { InvitationDocument, SideId } from "@contracts/invitation";
import type { AssetUrlMap } from "@/lib/builtin-assets";
import {
  getPhotoCraftStatus,
  syncPhotoCraftRuntime,
  type PhotoCraftRuntimeSnapshot,
  type PhotoCraftRuntimeStatus,
} from "@/lib/photocraft-runtime";

interface RuntimeSnapshot extends PhotoCraftRuntimeSnapshot {
  sideId: SideId;
  includeBlangko: boolean;
}

export function usePhotoCraftRuntime(options: {
  document: InvitationDocument;
  sideId: SideId;
  assets: AssetUrlMap;
  includeBlangko: boolean;
  enabled: boolean;
}) {
  const { document, sideId, assets, includeBlangko, enabled } = options;
  const [status, setStatus] = useState<PhotoCraftRuntimeStatus | null>(null);
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const sequence = useRef(0);

  useEffect(() => {
    let live = true;
    getPhotoCraftStatus()
      .then((value) => { if (live) setStatus(value); })
      .catch((reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : "Status runtime gagal dibaca.");
      });
    return () => { live = false; };
  }, [retryToken]);

  useEffect(() => {
    const current = ++sequence.current;
    if (!enabled || !status?.available) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSyncing(true);
      setError(null);
      syncPhotoCraftRuntime({
        document, sideId, assets, includeBlangko,
        signal: controller.signal,
      }).then((result) => {
        if (current !== sequence.current) return;
        setSnapshot({ ...result, sideId, includeBlangko });
        setSyncing(false);
      }).catch((reason: unknown) => {
        if (current !== sequence.current || controller.signal.aborted) return;
        setSnapshot(null);
        setSyncing(false);
        setError(reason instanceof Error ? reason.message : "Sinkronisasi PhotoCraft gagal.");
      });
    }, 450);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [assets, document, enabled, includeBlangko, retryToken, sideId, status?.available]);

  const currentSnapshot = snapshot?.sideId === sideId && snapshot.includeBlangko === includeBlangko
    ? snapshot
    : null;

  const activeError = enabled ? error : null;

  return {
    status,
    snapshot: currentSnapshot,
    syncing: Boolean(enabled && status?.available && syncing),
    error: activeError,
    usingEngine: Boolean(enabled && status?.available && !activeError && currentSnapshot),
    retry: () => setRetryToken((value) => value + 1),
  };
}
