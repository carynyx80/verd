// End-to-end smoke test against a deployed backend + cluster, doing exactly what the website does:
// upload logo -> file IPO (with token metadata) -> publish signed profile -> order -> bell -> claim -> buy/sell.
// Usage: node scripts/smoke.mjs --rpc https://api.devnet.solana.com --api https://verd-server-production.up.railway.app [--keep]
// Signs with ~/.config/solana/id.json. Hides the test listing afterwards when that wallet is in ADMIN_WALLETS (unless --keep).
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { createHash, createPrivateKey, sign } from "crypto";
import anchor from "@anchor-lang/core";
import bs58 from "bs58";
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const rpc = arg("rpc", "http://127.0.0.1:8899");
const API = arg("api", "http://localhost:4000").replace(/\/$/, "");
const keep = argv.includes("--keep");

const kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config/solana/id.json"), "utf8"))));
const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), Buffer.from(kp.secretKey.slice(0, 32))]);
const privKey = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
const signMsg = (text) => bs58.encode(sign(null, Buffer.from(text), privKey));

const idl = JSON.parse(fs.readFileSync(new URL("../target/idl/verd.json", import.meta.url)));
const conn = new Connection(rpc, "confirmed");
const program = new anchor.Program(idl, new anchor.AnchorProvider(conn, new anchor.Wallet(kp), { commitment: "confirmed" }));
const pda = (seeds) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];
const { BN } = anchor;

const step = async (name, fn) => {
  process.stdout.write(`• ${name} … `);
  try { const r = await fn(); console.log("ok" + (r ? ` (${r})` : "")); return r; }
  catch (e) { console.log("FAILED"); console.error(e?.error?.errorMessage || e?.message || e); process.exit(1); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const config = await program.account.config.fetch(pda([Buffer.from("config")]));
console.log(`cluster ${rpc}\nbackend ${API}\nwallet  ${kp.publicKey.toBase58()} (${(await conn.getBalance(kp.publicKey)) / LAMPORTS_PER_SOL} SOL)\npaused  ${config.paused}\n`);

// A real 64x64 PNG generated on the fly (green square).
function makePng(size = 64) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3, Buffer.from([61, 214, 140]))]);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const png = makePng();
const logo = await step("upload logo", async () => {
  const res = await fetch(`${API}/api/uploads?kind=logo`, { method: "POST", headers: { "content-type": "image/png" }, body: png });
  const d = await res.json(); if (!res.ok) throw new Error(d.error); return d.id;
});

const launchId = new BN(Date.now());
const launch = pda([Buffer.from("launch"), kp.publicKey.toBuffer(), launchId.toArrayLike(Buffer, "le", 8)]);
const mint = pda([Buffer.from("mint"), launch.toBuffer()]);
await step("file IPO on-chain (with wallet metadata)", () =>
  program.methods.createLaunch(launchId, "Smoke Test", "SMOKE", new BN(1000 * 1e6), new BN(0), new BN(1_000_000), new BN(2_000_000), 3000,
    new BN(0), new BN(45), new BN(Number(config.minLockSecs)), `${API}/metadata/${launch.toBase58()}.json`)
    .accounts({ creator: kp.publicKey }).rpc().then((s) => s.slice(0, 12)));

await step("publish signed profile", async () => {
  const f = { tagline: "Automated smoke test listing", description: "Created by scripts/smoke.mjs to verify the deployment end to end.", persona: "Brief.", prospectus: "## Overview\nSmoke test.\n## Risks\n- None, it's a test", website: "", emoji: "🤖", logo, banner: "" };
  const digest = createHash("sha256").update(JSON.stringify([f.tagline, f.description, f.persona, f.prospectus, f.website, f.emoji, f.logo, f.banner])).digest("hex");
  const signature = signMsg(`Stewra: publish agent profile\nlaunch: ${launch.toBase58()}\ndigest: ${digest}`);
  const res = await fetch(`${API}/api/agents`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ launch: launch.toBase58(), ...f, signature }) });
  const d = await res.json(); if (!res.ok) throw new Error(d.error);
});

await step("wallet metadata JSON", async () => {
  const d = await (await fetch(`${API}/metadata/${launch.toBase58()}.json`)).json();
  if (d.symbol !== "SMOKE" || !d.image) throw new Error(JSON.stringify(d));
  const img = await fetch(d.image); if (!img.ok) throw new Error(`image ${img.status}`);
  return "name, ticker, logo";
});

await step("place order (0.5 SOL at max price)", () =>
  program.methods.placeOrder(new BN(0.5 * LAMPORTS_PER_SOL), 9).accounts({ launch, buyer: kp.publicKey }).rpc().then((s) => s.slice(0, 12)));

const l0 = await program.account.launch.fetch(launch);
const chainNow = async () => (await conn.getBlockTime(await conn.getSlot())) ?? Math.floor(Date.now() / 1000);
await step("wait for the book to close (cluster clock)", async () => {
  const start = Date.now();
  while ((await chainNow()) < Number(l0.orderEnd) + 1) {
    if (Date.now() - start > 5 * 60_000) throw new Error("book did not close within 5 minutes");
    await sleep(3000);
  }
  return `${Math.round((Date.now() - start) / 1000)}s`;
});

await step("ring the bell", () =>
  program.methods.finalize().accounts({ launch, creator: kp.publicKey, treasury: config.treasury, caller: kp.publicKey }).rpc().then((s) => s.slice(0, 12)));

await step("claim allocation", () => program.methods.claim().accounts({ launch, buyer: kp.publicKey }).rpc().then((s) => s.slice(0, 12)));
const ata = getAssociatedTokenAddressSync(mint, kp.publicKey);
const bal = Number((await conn.getTokenAccountBalance(ata)).value.amount);
await step("token balance after claim", async () => { if (bal <= 0) throw new Error("no tokens"); return `${bal / 1e6} SMOKE`; });

await step("buy on the pool", () => program.methods.swap(new BN(0.01 * LAMPORTS_PER_SOL), new BN(0), true).accounts({ launch, treasury: config.treasury, trader: kp.publicKey }).rpc().then((s) => s.slice(0, 12)));
await step("sell on the pool", () => program.methods.swap(new BN(Math.floor(bal / 2)), new BN(0), false).accounts({ launch, treasury: config.treasury, trader: kp.publicKey }).rpc().then((s) => s.slice(0, 12)));

if (!keep) {
  await step("hide test listing (admin)", async () => {
    const ts = Date.now();
    const body = { wallet: kp.publicKey.toBase58(), ts, action: "hide", launch: launch.toBase58(), note: "smoke test", signature: signMsg(`Stewra admin\naction: hide\nlaunch: ${launch.toBase58()}\nts: ${ts}`) };
    const res = await fetch(`${API}/api/admin/hide`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json(); if (!res.ok) throw new Error(d.error);
  });
}
console.log(`\nAll steps passed. Listing: ${launch.toBase58()}`);
