import { useEffect, useRef, useState } from "react";
import { checkHealth } from "./api";

export type BackendStatus = "checking" | "online" | "offline";

const IDLE_INTERVAL_MS = 15_000;
const BUSY_INTERVAL_MS = 5_000;
const IDLE_FAIL_THRESHOLD = 2;
const BUSY_FAIL_THRESHOLD = 3;
const BUSY_GRACE_MS = 20_000;

export function useBackendStatus(
  busy: boolean,
  busyStartedAt: number | null,
  onAbort: () => void,
  onOnline: () => void
) {
  const [status, setStatus] = useState<BackendStatus>("checking");
  const [healthOk, setHealthOk] = useState(false);
  const failuresRef = useRef(0);
  const wasOnlineRef = useRef(false);
  const onAbortRef = useRef(onAbort);
  const onOnlineRef = useRef(onOnline);

  onAbortRef.current = onAbort;
  onOnlineRef.current = onOnline;

  useEffect(() => {
    if (busy) {
      failuresRef.current = 0;
    }
  }, [busy]);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const ok = await checkHealth();
      if (cancelled) return;

      if (ok) {
        failuresRef.current = 0;
        setHealthOk(true);
        if (!wasOnlineRef.current) {
          onOnlineRef.current();
        }
        wasOnlineRef.current = true;
        setStatus("online");
        return;
      }

      setHealthOk(false);
      failuresRef.current += 1;

      const inGrace =
        busy &&
        busyStartedAt !== null &&
        Date.now() - busyStartedAt < BUSY_GRACE_MS;

      const threshold = busy ? BUSY_FAIL_THRESHOLD : IDLE_FAIL_THRESHOLD;

      if (busy && !inGrace && failuresRef.current >= threshold) {
        failuresRef.current = 0;
        onAbortRef.current();
      }

      if (!busy && failuresRef.current >= threshold) {
        wasOnlineRef.current = false;
        setStatus("offline");
      }
    };

    void tick();
    const interval = setInterval(
      () => void tick(),
      busy ? BUSY_INTERVAL_MS : IDLE_INTERVAL_MS
    );

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [busy, busyStartedAt]);

  return { status, healthOk };
}
