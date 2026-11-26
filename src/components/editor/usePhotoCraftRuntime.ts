import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { InvitationDocument, SideId } from "@contracts/invitation";
import type { AssetUrlMap } from "@/lib/builtin-assets";
import {
  getPhotoCraftStatus,
  sideContentKey,
  syncPhotoCraftRuntime,
  type PhotoCraftRuntimeSnapshot,
  type PhotoCraftRuntimeStatus,
} from "@/lib/photocraft-runtime";

interface RuntimeSnapshot extends PhotoCraftRuntimeSnapshot {
  sideId: SideId;
  includeBlangko: boolean;
  /** Content key this snapshot was rendered from; lets the canvas recognise echoes of its own write-backs. */
  key: string;
}

interface SideCacheEntry {
  key: string;
  snapshot: RuntimeSnapshot;
}

const SYNC_DEBOUNCE_MS = 700;

export function usePhotoCraftRuntime(options: {
  document: InvitationDocument;
  sideId: SideId;
  assets: AssetUrlMap;
  includeBlangko: boolean;
  enabled: boolean;
}) {
  const { document, sideId, assets, includeBlangko, enabled } = options;
  const [status, setStatus] = useState<PhotoCraftRuntimeStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [flushToken, setFlushToken] = useState(0);
  // Per-side snapshot cache: switching back to a side whose content key still
  // matches opens instantly without a new server render. The state Map is read
  // during render; the ref mirror serves async callbacks only.
  const [cache, setCache] = useState<Map<SideId, SideCacheEntry>>(new Map());
  const cacheRef = useRef(cache);
  const sequence = useRef(0);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  const activeController = useRef<AbortController | null>(null);
  const prewarmController = useRef<AbortController | null>(null);
  const latest = useRef({ document, sideId, assets, includeBlangko });

  const activeKey = useMemo(
    () => sideContentKey(document, sideId, assets, includeBlangko),
    [document, sideId, assets, includeBlangko],
  );
  const activeEntry = cache.get(sideId) ?? null;
  const activeFresh = activeEntry?.key === activeKey;

  const writeCache = useCallback((id: SideId, entry: SideCacheEntry) => {
    setCache((previous) => new Map(previous).set(id, entry));
  }, []);

  useEffect(() => {
    cacheRef.current = cache;
  }, [cache]);

  useEffect(() => {
    latest.current = { document, sideId, assets, includeBlangko };
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current += 1;
      activeController.current?.abort();
      prewarmController.current?.abort();
    };
  }, []);

  useEffect(() => {
    let live = true;
    getPhotoCraftStatus()
      .then((value) => { if (live) setStatus(value); })
      .catch((reason: unknown) => {
        if (live) setError(reason instanceof Error ? reason.message : "Status runtime gagal dibaca.");
      });
    return () => { live = false; };
  }, [retryToken]);

  // Pre-render the passive side once so the first side switch opens from cache
  // instead of waiting for a full server render. Cold entries only: stale
  // entries are refreshed when their side is visited, keeping render load low.
  // The request is aborted as soon as new content arrives; the server skips
  // aborted work that is still waiting in its serial engine queue.
  const prewarmPassiveSide = useCallback(() => {
    const current = latest.current;
    const passive = current.document.sides.find((side) => side.id !== current.sideId);
    if (!passive || prewarmController.current) return;
    if (cacheRef.current.has(passive.id)) return;
    const key = sideContentKey(current.document, passive.id, current.assets, current.includeBlangko);
    const controller = new AbortController();
    prewarmController.current = controller;
    syncPhotoCraftRuntime({
      document: current.document,
      sideId: passive.id,
      assets: current.assets,
      includeBlangko: current.includeBlangko,
      signal: controller.signal,
    }).then((result) => {
      if (!mounted.current || controller.signal.aborted) return;
      // Cache only when the passive side is still in the state we rendered.
      const now = latest.current;
      if (sideContentKey(now.document, passive.id, now.assets, now.includeBlangko) !== key) return;
      writeCache(passive.id, {
        key,
        snapshot: { ...result, sideId: passive.id, includeBlangko: current.includeBlangko, key },
      });
    }).catch(() => undefined)
      .finally(() => {
        if (prewarmController.current === controller) prewarmController.current = null;
      });
  }, [writeCache]);

  useEffect(() => {
    const current = ++sequence.current;
    if (!enabled || !status?.available || activeFresh) return;

    // New content makes any passive pre-warm stale; drop it before it occupies
    // the serial engine queue.
    prewarmController.current?.abort();

    // A new canonical snapshot is prepared in the background. The active native
    // document remains usable, and only one request per editor is ever in flight.
    const timer = window.setTimeout(() => {
      if (inFlight.current) return;
      inFlight.current = true;
      setSyncing(true);
      const controller = new AbortController();
      activeController.current = controller;
      setError(null);
      syncPhotoCraftRuntime({
        document, sideId, assets, includeBlangko,
        signal: controller.signal,
      }).then((result) => {
        if (!mounted.current || current !== sequence.current) return;
        writeCache(sideId, { key: activeKey, snapshot: { ...result, sideId, includeBlangko, key: activeKey } });
        setError(null);
        prewarmPassiveSide();
      }).catch((reason: unknown) => {
        if (!mounted.current || current !== sequence.current || controller.signal.aborted) return;
        // Keep the last good snapshot visible when a refresh fails.
        setError(reason instanceof Error ? reason.message : "Sinkronisasi PhotoCraft gagal.");
      }).finally(() => {
        inFlight.current = false;
        if (activeController.current === controller) activeController.current = null;
        if (!mounted.current) return;
        if (current === sequence.current) setSyncing(false);
        else setFlushToken((value) => value + 1);
      });
    }, SYNC_DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [activeFresh, activeKey, assets, document, enabled, includeBlangko, prewarmPassiveSide, retryToken, flushToken, sideId, status?.available, writeCache]);

  // A cached snapshot is only usable for the projection it was rendered with;
  // a blangko toggle keeps the old native document until the refresh lands.
  const snapshot = activeEntry && activeEntry.snapshot.includeBlangko === includeBlangko
    ? activeEntry.snapshot
    : null;

  const activeError = enabled ? error : null;

  return {
    status,
    snapshot,
    syncing: Boolean(enabled && status?.available && syncing),
    error: activeError,
    usingEngine: Boolean(enabled && status?.available && snapshot),
    retry: () => setRetryToken((value) => value + 1),
  };
}
