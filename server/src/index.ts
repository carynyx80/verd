// Stewra backend: agent profiles, live roadshow Q&A (Claude) and prospectus drafting.
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { listProfiles, getProfile, saveProfile, getTranscript, appendTranscript, type AgentProfile } from "./store.js";
import { answerRoadshow, draftProspectus, RoadshowUnavailable } from "./claude.js";
import { getLaunchOnChain, profileMessage, RPC_URL } from "./chain.js";
import { profileDigest } from "./digest.js";
import { allow } from "./ratelimit.js";
import path from "path";
import { saveImage, imageExists, UploadError, IMAGE_ID, ACCEPTED_TYPES, MAX_UPLOAD_BYTES, UPLOAD_DIR, type ImageKind } from "./uploads.js";

const app = express();
app.set("trust proxy", 1); // Railway sits behind a proxy; req.ip is the real client
app.use(express.json({ limit: "64kb" }));

// Only the configured frontends may call the API from a browser.
const origins = (process.env.CORS_ORIGINS || "http://localhost:3000").split(",").map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin(origin, cb) {
      if (!origin) return cb(null, true); // curl, health checks
      const ok = origins.some((o) => (o.startsWith("*.") ? origin.endsWith(o.slice(1)) : origin === o));
      cb(null, ok);
    },
  })
);

const clip = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const isPubkey = (s: string) => { try { new PublicKey(s); return true; } catch { return false; } };
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);

app.get("/health", (_req, res) => {
  res.json({ ok: true, rpc: RPC_URL, ai: Boolean(process.env.ANTHROPIC_API_KEY) });
});

// ───── agent profiles ─────

app.get("/api/agents", wrap(async (_req, res) => {
  res.json(await listProfiles());
}));

app.get("/api/agents/:launch", wrap(async (req, res) => {
  const p = await getProfile(req.params.launch);
  if (!p) return res.status(404).json({ error: "No profile yet" });
  res.json(p);
}));

app.post("/api/agents", wrap(async (req, res) => {
  const body = req.body ?? {};
  if (typeof body.launch !== "string" || !isPubkey(body.launch)) return res.status(400).json({ error: "Invalid launch address" });
  if (!allow(`ag:${req.ip}`, 10, 60_000)) return res.status(429).json({ error: "Too many requests" });

  const fields = {
    tagline: clip(body.tagline, 120),
    description: clip(body.description, 2000),
    persona: clip(body.persona, 2000),
    prospectus: clip(body.prospectus, 6000),
    website: clip(body.website, 200),
    emoji: clip(body.emoji, 8) || "🤖",
    logo: typeof body.logo === "string" ? body.logo : "",
    banner: typeof body.banner === "string" ? body.banner : "",
  };
  for (const id of [fields.logo, fields.banner]) {
    if (id && !(await imageExists(id))) return res.status(400).json({ error: "Image not found. Upload it again." });
  }
  if (!fields.tagline || !fields.description) return res.status(400).json({ error: "Tagline and description are required" });

  const launch = await getLaunchOnChain(body.launch);
  if (!launch) return res.status(404).json({ error: "Launch not found on-chain" });

  // Only the on-chain creator may publish or edit the profile.
  const msg = new TextEncoder().encode(profileMessage(body.launch, profileDigest(fields)));
  let ok = false;
  try {
    ok = ed25519.verify(bs58.decode(String(body.signature)), msg, new PublicKey(launch.creator).toBytes());
  } catch {
    ok = false;
  }
  if (!ok) return res.status(401).json({ error: "Signature does not match the launch creator" });

  const existing = await getProfile(body.launch);
  const profile: AgentProfile = {
    launch: body.launch,
    creator: launch.creator,
    name: launch.name,
    symbol: launch.symbol,
    ...fields,
    logo: fields.logo || undefined,
    banner: fields.banner || undefined,
    createdAt: existing?.createdAt ?? Date.now(),
  };
  await saveProfile(profile);
  res.json(profile);
}));

// ───── images ─────

app.post(
  "/api/uploads",
  express.raw({ type: ACCEPTED_TYPES, limit: MAX_UPLOAD_BYTES }),
  wrap(async (req, res) => {
    const kind = req.query.kind === "banner" ? "banner" : req.query.kind === "logo" ? "logo" : null;
    if (!kind) return res.status(400).json({ error: "Missing image kind" });
    if (!allow(`up:${req.ip}`, 30, 10 * 60_000)) return res.status(429).json({ error: "Too many uploads. Try again in a few minutes." });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(415).json({ error: "Use a PNG, JPG, WebP or GIF image." });
    }
    const id = await saveImage(req.body, kind as ImageKind);
    res.json({ id });
  })
);

app.get("/uploads/:id", (req, res) => {
  const { id } = req.params;
  if (!IMAGE_ID.test(id)) return res.status(404).end();
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.type("image/webp");
  res.sendFile(path.join(UPLOAD_DIR, id), (err) => {
    if (err && !res.headersSent) res.status(404).end();
  });
});

// ───── roadshow ─────

app.get("/api/roadshow/:launch", wrap(async (req, res) => {
  res.json(await getTranscript(req.params.launch));
}));

app.post("/api/roadshow/:launch", wrap(async (req, res) => {
  const { launch } = req.params;
  if (!isPubkey(launch)) return res.status(400).json({ error: "Invalid launch address" });
  if (!allow(`rs:${req.ip}`, 6, 60_000) || !allow(`rs-launch:${launch}`, 60, 60_000)) {
    return res.status(429).json({ error: "Slow down a little — too many questions per minute" });
  }
  const question = clip(req.body?.question, 500);
  if (question.length < 3) return res.status(400).json({ error: "Questions must be 3–500 characters" });

  const [profile, onchain] = await Promise.all([getProfile(launch), getLaunchOnChain(launch)]);
  if (!onchain) return res.status(404).json({ error: "Launch not found" });
  if (!profile) return res.status(409).json({ error: "This agent hasn't published its profile yet" });
  if (onchain.finalized) return res.status(409).json({ error: "The roadshow is over — this agent is already trading" });

  const history = await getTranscript(launch);
  const answer = await answerRoadshow(profile, history, question);
  const asker = typeof req.body?.asker === "string" && isPubkey(req.body.asker) ? req.body.asker : undefined;
  const entry = { id: randomUUID(), question, answer, asker, at: Date.now() };
  await appendTranscript(launch, entry);
  res.json(entry);
}));

// ───── prospectus drafting ─────

app.post("/api/prospectus", wrap(async (req, res) => {
  if (!allow(`pr:${req.ip}`, 5, 60_000)) return res.status(429).json({ error: "Too many drafts — wait a minute" });
  const b = req.body ?? {};
  if (typeof b.name !== "string" || typeof b.description !== "string" || b.description.length < 10) {
    return res.status(400).json({ error: "Add a name and a description first" });
  }
  const text = await draftProspectus({
    name: clip(b.name, 32),
    symbol: clip(b.symbol, 10),
    tagline: clip(b.tagline, 120),
    description: clip(b.description, 2000),
    saleTokens: Number(b.saleTokens) || 0,
    creatorPct: Number(b.creatorPct) || 0,
    lpPct: Number(b.lpPct) || 0,
    lockDays: Number(b.lockDays) || 0,
  });
  res.json({ prospectus: text });
}));

// ───── errors ─────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof RoadshowUnavailable) return res.status(503).json({ error: err.message });
  if (err instanceof UploadError) return res.status(400).json({ error: err.message });
  if ((err as { type?: string })?.type === "entity.too.large") return res.status(413).json({ error: "Image is too large. Max 5 MB." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server" });
});

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => console.log(`stewra-server listening on :${port} (rpc ${RPC_URL}, origins ${origins.join(", ")})`));
