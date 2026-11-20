// Stewra backend: agent profiles, live roadshow Q&A (Claude) and prospectus drafting.
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import { randomUUID } from "crypto";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { listProfiles, getProfile, saveProfile, getTranscript, appendTranscript, getModeration, setHidden, isHidden, listReports, addReport, resolveReports, exportAll, snapshot, type AgentProfile } from "./store.js";
import { verifyAdmin, adminsConfigured } from "./admin.js";
import { answerRoadshow, draftProspectus, RoadshowUnavailable } from "./claude.js";
import { RPC_URL, NETWORK, COMPANY } from "./solana.js";
import * as ipo from "./ipo.js";
import { buildSwap } from "./meteora.js";

const profileMessage = (launch: string, digest: string) => `Stewra: publish agent profile\nlaunch: ${launch}\ndigest: ${digest}`;
const getLaunchOnChain = async (id: string) => {
  const l = ipo.getLaunch(id);
  return l && l.status !== "pending" && l.status !== "expired" ? { creator: l.creator, name: l.name, symbol: l.symbol, finalized: Boolean(l.clearing) } : null;
};
import { profileDigest } from "./digest.js";
import { allow } from "./ratelimit.js";
import path from "path";
import sharp from "sharp";
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
      // "*-team.vercel.app" style entries match by suffix, so every deployment URL of the project works.
      const ok = origins.some((o) => (o.startsWith("*") ? /^https:\/\/[a-z0-9.-]+$/.test(origin) && origin.endsWith(o.slice(1)) : origin === o));
      cb(null, ok);
    },
  })
);

const clip = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");
const isPubkey = (s: string) => { try { new PublicKey(s); return true; } catch { return false; } };
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch(next);

app.get("/health", (_req, res) => {
  res.json({ ok: true, network: NETWORK, company: COMPANY?.toBase58() ?? null, ai: Boolean(process.env.ANTHROPIC_API_KEY), now: Math.floor(Date.now() / 1000) });
});

// ───── agent profiles ─────

app.get("/api/agents", wrap(async (_req, res) => {
  res.json(await listProfiles());
}));

app.get("/api/agents/:launch", wrap(async (req, res) => {
  const p = await getProfile(req.params.launch);
  if (!p) return res.status(404).json({ error: "No profile yet" });
  res.json({ ...p, hidden: await isHidden(req.params.launch) });
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
  if (!launch) return res.status(404).json({ error: "Listing not found" });

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

// PNG copy for link-preview generators that can't decode WebP.
app.get("/uploads/:hash.png", wrap(async (req, res) => {
  const id = `${req.params.hash}.webp`;
  if (!IMAGE_ID.test(id) || !(await imageExists(id))) return res.status(404).end();
  const png = await sharp(path.join(UPLOAD_DIR, id)).png().toBuffer();
  res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  res.type("image/png").send(png);
}));

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

// ───── wallet token metadata (Metaplex JSON) ─────

const SITE_URL = (process.env.SITE_URL || "").replace(/\/$/, "");
const PUBLIC_API_URL = (process.env.PUBLIC_API_URL || "").replace(/\/$/, "");

app.get("/metadata/:file", wrap(async (req, res) => {
  const launch = req.params.file.replace(/\.json$/, "");
  if (!isPubkey(launch)) return res.status(404).json({ error: "Not found" });
  const [onchain, profile] = await Promise.all([getLaunchOnChain(launch), getProfile(launch)]);
  if (!onchain) return res.status(404).json({ error: "Not found" });
  const base = PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`;
  const hidden = await isHidden(launch);
  res.setHeader("Cache-Control", "public, max-age=300");
  res.json({
    name: onchain.name,
    symbol: onchain.symbol,
    description: hidden ? "" : profile?.tagline ?? "",
    image: !hidden && profile?.logo ? `${base}/uploads/${profile.logo.replace(/\.webp$/, "")}.png` : undefined,
    external_url: SITE_URL ? `${SITE_URL}/launch/${launch}` : undefined,
  });
}));

// ───── moderation ─────

app.get("/api/moderation", wrap(async (_req, res) => {
  const m = await getModeration();
  res.setHeader("Cache-Control", "public, max-age=15");
  res.json({ hidden: Object.keys(m.hidden) });
}));

const REASONS = ["impersonation", "scam", "offensive", "copyright", "other"];

app.post("/api/reports", wrap(async (req, res) => {
  if (!allow(`rp:${req.ip}`, 10, 60 * 60_000)) return res.status(429).json({ error: "Too many reports. Try again later." });
  const launch = String(req.body?.launch ?? "");
  const reason = String(req.body?.reason ?? "");
  if (!isPubkey(launch) || !REASONS.includes(reason)) return res.status(400).json({ error: "Choose a reason" });
  const reporter = typeof req.body?.reporter === "string" && isPubkey(req.body.reporter) ? req.body.reporter : undefined;
  await addReport({ id: randomUUID(), launch, reason, details: clip(req.body?.details, 500), reporter, at: Date.now() });
  res.json({ ok: true });
}));

// ───── admin (wallet-signature auth) ─────

app.get("/api/admin/status", (_req, res) => res.json({ configured: adminsConfigured() }));

function admin(action: string, launchRequired: boolean) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!adminsConfigured()) return res.status(503).json({ error: "No admin wallets configured on the server (ADMIN_WALLETS)" });
    if (req.body?.action !== action) return res.status(400).json({ error: "Wrong action" });
    if (launchRequired && !isPubkey(String(req.body?.launch ?? ""))) return res.status(400).json({ error: "Invalid launch" });
    const problem = verifyAdmin(req.body);
    if (problem) return res.status(401).json({ error: problem });
    next();
  };
}

app.post("/api/admin/reports", admin("list-reports", false), wrap(async (_req, res) => {
  const [reports, m, profiles] = await Promise.all([listReports(), getModeration(), listProfiles()]);
  res.json({ reports: reports.slice().reverse(), hidden: m.hidden, names: Object.fromEntries(Object.values(profiles).map((p) => [p.launch, `${p.name} $${p.symbol}`])) });
}));

app.post("/api/admin/hide", admin("hide", true), wrap(async (req, res) => {
  await setHidden(req.body.launch, true, clip(req.body?.note, 200));
  await resolveReports(req.body.launch);
  res.json({ ok: true });
}));

app.post("/api/admin/unhide", admin("unhide", true), wrap(async (req, res) => {
  await setHidden(req.body.launch, false);
  res.json({ ok: true });
}));

app.post("/api/admin/export", admin("export", false), wrap(async (_req, res) => {
  res.setHeader("Content-Disposition", `attachment; filename="stewra-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(await exportAll());
}));

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
  if (await isHidden(launch)) return res.status(403).json({ error: "This listing has been removed" });

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

// ───── IPOs (company-wallet escrow) ─────

let hiddenCache = new Set<string>();

app.get("/api/platform", (_req, res) => res.json(ipo.platform()));

// ───── Solana RPC relay ─────
// Public mainnet RPC rejects browser requests, and a paid RPC key shouldn't ship to browsers.
// The site talks to Solana through here: only the read/send methods it needs, rate-limited per IP.
const RPC_METHODS = new Set([
  "getLatestBlockhash", "isBlockhashValid", "getBlockHeight", "getSlot", "getEpochInfo", "getBalance", "getAccountInfo",
  "getMultipleAccounts", "getTokenAccountBalance", "getTokenAccountsByOwner", "getSignatureStatuses", "getMinimumBalanceForRentExemption",
  "getFeeForMessage", "getRecentPrioritizationFees", "simulateTransaction", "sendTransaction", "getBlockTime", "getVersion", "getGenesisHash",
]);
app.post("/rpc", express.json({ limit: "256kb" }), wrap(async (req, res) => {
  const calls = Array.isArray(req.body) ? req.body : [req.body];
  if (!calls.length || calls.length > 20) return res.status(400).json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request" } });
  if (!allow(`rpc:${req.ip}`, 240, 60_000)) return res.status(429).json({ jsonrpc: "2.0", id: null, error: { code: 429, message: "Too many requests" } });
  for (const c of calls) {
    if (!c || typeof c.method !== "string" || !RPC_METHODS.has(c.method)) {
      return res.status(403).json({ jsonrpc: "2.0", id: c?.id ?? null, error: { code: -32601, message: `Method not allowed: ${String(c?.method).slice(0, 40)}` } });
    }
  }
  const upstream = await fetch(RPC_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req.body) });
  res.status(upstream.status).type("application/json").send(await upstream.text());
}));

app.get("/api/launches", wrap(async (_req, res) => {
  res.json(await ipo.listLaunches());
}));

app.get("/api/launches/:id", wrap(async (req, res) => {
  const l = ipo.getLaunch(req.params.id);
  if (!l || l.status === "pending" || l.status === "expired") return res.status(404).json({ error: "Listing not found" });
  res.json(await ipo.launchView(l));
}));

const int = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.floor(v) : NaN);
const bigStr = (v: unknown) => (typeof v === "string" && /^\d{1,20}$/.test(v) ? v : "x");

app.post("/api/launches/prepare", wrap(async (req, res) => {
  if (!allow(`file:${req.ip}`, 10, 60 * 60_000)) return res.status(429).json({ error: "Too many filings. Try again later." });
  const b = req.body ?? {};
  if (typeof b.creator !== "string" || !isPubkey(b.creator)) return res.status(400).json({ error: "Connect your wallet first" });
  const input: ipo.FilingInput = {
    creator: b.creator, name: clip(b.name, 32), symbol: clip(b.symbol, 10).toUpperCase(),
    saleSupply: bigStr(b.saleSupply), creatorSupply: bigStr(b.creatorSupply), minPrice: bigStr(b.minPrice), maxPrice: bigStr(b.maxPrice),
    lpBps: int(b.lpBps), roadshowSecs: int(b.roadshowSecs), orderSecs: int(b.orderSecs), lockSecs: int(b.lockSecs),
  };
  const problem = ipo.validateFiling(input);
  if (problem) return res.status(400).json({ error: problem });
  const base = PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`;
  res.json(await ipo.prepareFiling(input, (mint) => `${base}/metadata/${mint}.json`));
}));

app.post("/api/launches/:id/confirm", wrap(async (req, res) => {
  const l = await ipo.confirmFiling(req.params.id);
  if (!l) return res.status(404).json({ error: "Unknown filing" });
  res.json({ status: l.status });
}));

/** The buyer's browser reports its deposit right away; the background scan would find it anyway. */
app.post("/api/orders", wrap(async (req, res) => {
  const sig = String(req.body?.signature ?? "");
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig)) return res.status(400).json({ error: "Invalid signature" });
  if (!allow(`ord:${req.ip}`, 60, 60_000)) return res.status(429).json({ error: "Too many requests" });
  const outcome = await ipo.ingest(sig);
  if (outcome === null) return res.status(202).json({ status: "confirming" });
  res.json({ status: outcome });
}));

app.get("/api/launches/:id/position", wrap(async (req, res) => {
  const buyer = String(req.query.buyer ?? "");
  if (!isPubkey(buyer)) return res.status(400).json({ error: "Invalid wallet" });
  res.json(ipo.position(req.params.id, buyer));
}));

app.post("/api/launches/:id/cancel", wrap(async (req, res) => {
  if (!allow(`cx:${req.ip}`, 10, 60_000)) return res.status(429).json({ error: "Too many requests" });
  const { buyer, ts, signature } = req.body ?? {};
  if (typeof buyer !== "string" || !isPubkey(buyer) || typeof ts !== "number" || typeof signature !== "string") return res.status(400).json({ error: "Invalid request" });
  const r = await ipo.cancel(req.params.id, buyer, ts, signature);
  if ("error" in r && r.error) return res.status(400).json(r);
  res.json(r);
}));

/** Unsigned swap transaction against the listing's locked Meteora pool; the trader signs it in their own wallet. */
app.post("/api/swap", wrap(async (req, res) => {
  if (!allow(`sw:${req.ip}`, 60, 60_000)) return res.status(429).json({ error: "Too many requests" });
  const { mint, trader, buy, amountIn, slippageBps } = req.body ?? {};
  const l = typeof mint === "string" ? ipo.getLaunch(mint) : null;
  if (!l?.pool) return res.status(400).json({ error: "Trading isn't open for this listing yet" });
  if (typeof trader !== "string" || !isPubkey(trader)) return res.status(400).json({ error: "Connect your wallet first" });
  if (typeof amountIn !== "string" || !/^\d{1,20}$/.test(amountIn) || amountIn === "0") return res.status(400).json({ error: "Enter an amount" });
  const slip = Math.min(1000, Math.max(10, Number(slippageBps) || 200));
  try {
    res.json(await buildSwap({ mint, trader, buy: Boolean(buy), amountIn: BigInt(amountIn), slippageBps: slip }));
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message.slice(0, 200) : "Couldn't build the trade" });
  }
}));

// ───── admin: company wallet payouts, pause, solvency ─────

app.post("/api/admin/payouts", admin("payouts", false), wrap(async (_req, res) => {
  res.json({ ...ipo.payoutQueue(), solvency: await ipo.solvency(), platform: ipo.platform() });
}));

app.post("/api/admin/payouts/build", admin("sign-payouts", false), wrap(async (_req, res) => {
  res.json({ items: await ipo.buildForAdmin(8) });
}));

/** No admin message needed: only the company wallet's own signature on the exact built message is accepted. */
app.post("/api/admin/payouts/submit", wrap(async (req, res) => {
  const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 20) : [];
  res.json({ results: await ipo.submitFromAdmin(items.filter((i: { id?: unknown; tx?: unknown }) => typeof i?.id === "string" && typeof i?.tx === "string")) });
}));

app.post("/api/admin/pause", admin("pause", false), wrap(async (req, res) => {
  await ipo.setPaused(true, clip(req.body?.note, 200));
  res.json({ ok: true });
}));

app.post("/api/admin/unpause", admin("unpause", false), wrap(async (_req, res) => {
  await ipo.setPaused(false);
  res.json({ ok: true });
}));

app.post("/api/admin/ledger", admin("ledger", false), wrap(async (_req, res) => {
  res.json({ ledger: await ipo.readLedger(1000), state: ipo.exportState() });
}));

// ───── errors ─────

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof RoadshowUnavailable) return res.status(503).json({ error: err.message });
  if (err instanceof UploadError) return res.status(400).json({ error: err.message });
  if ((err as { type?: string })?.type === "entity.too.large") return res.status(413).json({ error: "Image is too large. Max 5 MB." });
  console.error(err);
  res.status(500).json({ error: "Something went wrong on the server" });
});

// Rolling snapshots on the data volume: at boot and every 6 hours, last 14 kept.
const runSnapshot = () => snapshot().then((f) => console.log(`snapshot ${f}`)).catch((e) => console.error("snapshot failed", e));
setTimeout(runSnapshot, 10_000);
setInterval(runSnapshot, 6 * 60 * 60_000).unref();

await ipo.loadState();
ipo.setHiddenCheck((launch) => hiddenCache.has(launch));
const refreshHidden = () => getModeration().then((m) => { hiddenCache = new Set(Object.keys(m.hidden)); }).catch(() => {});
await refreshHidden();
setInterval(refreshHidden, 15_000).unref();
ipo.startWorker();

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => console.log(`stewra-server listening on :${port} (${NETWORK}, company ${COMPANY?.toBase58() ?? "NOT SET"}, origins ${origins.join(", ")})`));
