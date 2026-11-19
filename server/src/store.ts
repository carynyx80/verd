// Server-only JSON file store for agent profiles and roadshow transcripts.
// On Railway, DATA_DIR points at a mounted volume so data survives redeploys.
import { promises as fs } from "fs";
import path from "path";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const PROFILES = path.join(DATA_DIR, "agents.json");
const ROADSHOW_DIR = path.join(DATA_DIR, "roadshow");

export type AgentProfile = {
  launch: string;
  creator: string;
  name: string;
  symbol: string;
  tagline: string;
  description: string;
  persona: string; // creator's instructions for how the agent behaves in Q&A
  prospectus: string;
  website?: string;
  emoji: string;
  createdAt: number;
};

export type RoadshowEntry = {
  id: string;
  question: string;
  answer: string;
  asker?: string; // wallet, if connected
  at: number;
};

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2));
  await fs.rename(tmp, file);
}

export async function listProfiles(): Promise<Record<string, AgentProfile>> {
  return readJson(PROFILES, {} as Record<string, AgentProfile>);
}

export async function getProfile(launch: string): Promise<AgentProfile | null> {
  return (await listProfiles())[launch] ?? null;
}

export async function saveProfile(p: AgentProfile) {
  const all = await listProfiles();
  all[p.launch] = p;
  await writeJson(PROFILES, all);
}

const safe = (launch: string) => launch.replace(/[^1-9A-HJ-NP-Za-km-z]/g, "");

export async function getTranscript(launch: string): Promise<RoadshowEntry[]> {
  return readJson(path.join(ROADSHOW_DIR, `${safe(launch)}.json`), [] as RoadshowEntry[]);
}

export async function appendTranscript(launch: string, e: RoadshowEntry) {
  const file = path.join(ROADSHOW_DIR, `${safe(launch)}.json`);
  const all = await readJson(file, [] as RoadshowEntry[]);
  all.push(e);
  await writeJson(file, all);
}
