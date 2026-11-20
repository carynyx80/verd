"use client";
import { useCallback, useEffect, useState } from "react";
import { api, fetchLaunch, fetchLaunches, type Launch } from "./stewra";

// Offset between the Stewra server clock (which runs the schedule) and this device.
// Shared across components and refreshed at most once a minute.
let clockOffset = 0;
let clockFetchedAt = 0;
let clockInflight: Promise<void> | null = null;

function syncClock() {
  if (clockInflight || Date.now() - clockFetchedAt < 60_000) return clockInflight;
  clockInflight = (async () => {
    try {
      const t0 = Date.now();
      const d = await fetch(api("/health")).then((r) => r.json());
      if (typeof d.now === "number") clockOffset = d.now - (t0 + Date.now()) / 2000;
      clockFetchedAt = Date.now();
    } catch {
      // device clock is a fine fallback
    } finally {
      clockInflight = null;
    }
  })();
  return clockInflight;
}

/** Current time in unix seconds, aligned to the Stewra server. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now() / 1000 + clockOffset);
  useEffect(() => {
    syncClock();
    const t = setInterval(() => {
      syncClock();
      setNow(Date.now() / 1000 + clockOffset);
    }, intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Whether the backend has an AI model configured (roadshow answers, prospectus drafts). */
export function useBackend() {
  const [ai, setAi] = useState<boolean | null>(null);
  useEffect(() => {
    fetch(api("/health")).then((r) => r.json()).then((d) => setAi(Boolean(d.ai))).catch(() => setAi(false));
  }, []);
  return { ai };
}

export function useLaunches(pollMs = 6000) {
  const [launches, setLaunches] = useState<Launch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setLaunches(await fetchLaunches());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);
  return { launches, error, reload: load };
}

export function useLaunch(address: string, pollMs = 4000) {
  const [launch, setLaunch] = useState<Launch | null | undefined>(undefined);
  const load = useCallback(async () => {
    try {
      setLaunch(await fetchLaunch(address));
    } catch {
      setLaunch((cur) => cur ?? null);
    }
  }, [address]);
  useEffect(() => {
    load();
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);
  return { launch, reload: load };
}

export type PlatformConfig = {
  network: string; company: string | null; feeBps: number; swapFeeBps: number; minLockSecs: number;
  listingFee: number; paused: boolean; payoutMode: string;
};

export function useConfig() {
  const [config, setConfig] = useState<PlatformConfig | null>(null);
  useEffect(() => {
    const load = () => fetch(api("/api/platform")).then((r) => r.json()).then(setConfig).catch(() => setConfig(null));
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  return config;
}

export type Profile = {
  launch: string; creator: string; name: string; symbol: string; tagline: string;
  description: string; persona: string; prospectus: string; website?: string; emoji: string; logo?: string; banner?: string; hidden?: boolean; createdAt: number;
};

export function useProfiles(pollMs = 10000) {
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  useEffect(() => {
    const load = () => fetch(api("/api/agents")).then((r) => r.json()).then(setProfiles).catch(() => {});
    load();
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [pollMs]);
  return profiles;
}

/** Launch addresses hidden by moderators. */
export function useHidden(pollMs = 30000) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  useEffect(() => {
    const load = () => fetch(api("/api/moderation")).then((r) => r.json()).then((d) => setHidden(new Set(d.hidden ?? []))).catch(() => {});
    load();
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [pollMs]);
  return hidden;
}
