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
  logo?: string; // uploaded image id
  banner?: string; // uploaded image id
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

// ───── moderation ─────

const MODERATION = path.join(DATA_DIR, "moderation.json");
const REPORTS = path.join(DATA_DIR, "reports.json");

export type Report = { id: string; launch: string; reason: string; details: string; reporter?: string; at: number; resolved?: boolean };
type Moderation = { hidden: Record<string, { at: number; note: string }> };

export async function getModeration(): Promise<Moderation> {
  return readJson(MODERATION, { hidden: {} } as Moderation);
}

export async function setHidden(launch: string, hidden: boolean, note = "") {
  const m = await getModeration();
  if (hidden) m.hidden[launch] = { at: Date.now(), note };
  else delete m.hidden[launch];
  await writeJson(MODERATION, m);
  return m;
}

export async function isHidden(launch: string) {
  return Boolean((await getModeration()).hidden[launch]);
}

export async function listReports(): Promise<Report[]> {
  return readJson(REPORTS, [] as Report[]);
}

export async function addReport(r: Report) {
  const all = await listReports();
  all.push(r);
  await writeJson(REPORTS, all.slice(-5000));
}

export async function resolveReports(launch: string) {
  const all = await listReports();
  for (const r of all) if (r.launch === launch) r.resolved = true;
  await writeJson(REPORTS, all);
}

// ───── backups ─────

const BACKUP_DIR = path.join(DATA_DIR, "backups");

/** Full export of everything the backend stores (images are content-addressed and kept separately). */
export async function exportAll() {
  const profiles = await listProfiles();
  const transcripts: Record<string, RoadshowEntry[]> = {};
  for (const launch of Object.keys(profiles)) transcripts[launch] = await getTranscript(launch);
  return { exportedAt: new Date().toISOString(), profiles, transcripts, moderation: await getModeration(), reports: await listReports() };
}

/** Writes a dated snapshot and keeps the most recent `keep`. */
export async function snapshot(keep = 14) {
  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const name = `backup-${new Date().toISOString().slice(0, 13).replace(/[:T]/g, "-")}.json`;
  await writeJson(path.join(BACKUP_DIR, name), await exportAll());
  const files = (await fs.readdir(BACKUP_DIR)).filter((f) => f.startsWith("backup-")).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) await fs.unlink(path.join(BACKUP_DIR, f)).catch(() => {});
  return name;
}
