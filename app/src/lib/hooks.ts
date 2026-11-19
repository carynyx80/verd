"use client";
import { useCallback, useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { api, fetchLaunch, fetchLaunches, getProgram, configPda, type Launch } from "./stewra";

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function useLaunches(pollMs = 6000) {
  const { connection } = useConnection();
  const [launches, setLaunches] = useState<Launch[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setLaunches(await fetchLaunches(connection));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [connection]);
  useEffect(() => {
    load();
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);
  return { launches, error, reload: load };
}

export function useLaunch(address: string, pollMs = 4000) {
  const { connection } = useConnection();
  const [launch, setLaunch] = useState<Launch | null | undefined>(undefined);
  const load = useCallback(async () => {
    try {
      setLaunch(await fetchLaunch(connection, address));
    } catch {
      setLaunch(null);
    }
  }, [connection, address]);
  useEffect(() => {
    load();
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);
  return { launch, reload: load };
}

export type PlatformConfig = { feeBps: number; swapFeeBps: number; minLockSecs: number; treasury: string };

export function useConfig() {
  const { connection } = useConnection();
  const [config, setConfig] = useState<PlatformConfig | null>(null);
  useEffect(() => {
    getProgram(connection)
      .account.config.fetchNullable(configPda())
      .then((c) =>
        setConfig(
          c
            ? { feeBps: c.feeBps, swapFeeBps: c.swapFeeBps, minLockSecs: Number(c.minLockSecs.toString()), treasury: c.treasury.toBase58() }
            : null
        )
      )
      .catch(() => setConfig(null));
  }, [connection]);
  return config;
}

export type Profile = {
  launch: string; creator: string; name: string; symbol: string; tagline: string;
  description: string; persona: string; prospectus: string; website?: string; emoji: string; logo?: string; banner?: string; createdAt: number;
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
