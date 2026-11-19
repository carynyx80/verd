// Platform admin actions, signed with the admin keypair.
// Usage:
//   node scripts/admin.mjs status   [--rpc URL]
//   node scripts/admin.mjs pause    [--rpc URL]
//   node scripts/admin.mjs unpause  [--rpc URL]
//   node scripts/admin.mjs migrate  [--rpc URL]   one-time: adds the pause flag to an old config account
import fs from "fs";
import os from "os";
import path from "path";
import anchor from "@anchor-lang/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const [cmd = "status", ...rest] = process.argv.slice(2);
const args = Object.fromEntries(rest.reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []));
const rpc = args.rpc || "http://127.0.0.1:8899";
const keyPath = args.keypair || path.join(os.homedir(), ".config/solana/id.json");
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8"))));
const idl = JSON.parse(fs.readFileSync(new URL("../target/idl/verd.json", import.meta.url)));
if (args["program-id"]) idl.address = args["program-id"];

const connection = new Connection(rpc, "confirmed");
const program = new anchor.Program(idl, new anchor.AnchorProvider(connection, new anchor.Wallet(admin), { commitment: "confirmed" }));
const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);

async function show() {
  const info = await connection.getAccountInfo(config);
  if (!info) return console.log("No config account on this network.");
  try {
    const c = await program.account.config.fetch(config);
    console.log({ admin: c.admin.toBase58(), treasury: c.treasury.toBase58(), feeBps: c.feeBps, swapFeeBps: c.swapFeeBps, minLockSecs: c.minLockSecs.toString(), paused: c.paused, launches: c.launchCount.toString() });
  } catch {
    console.log(`Config uses the old layout (${info.data.length} bytes). Run: node scripts/admin.mjs migrate --rpc ${rpc}`);
  }
}

if (cmd === "status") await show();
else if (cmd === "migrate") {
  const sig = await program.methods.migrateConfig().accounts({ admin: admin.publicKey }).rpc();
  console.log(`migrated (${sig})`);
  await show();
} else if (cmd === "pause" || cmd === "unpause") {
  const sig = await program.methods.setPaused(cmd === "pause").accounts({ admin: admin.publicKey }).rpc();
  console.log(`${cmd}d (${sig})`);
  await show();
} else {
  console.error(`Unknown command: ${cmd}`);
  process.exit(1);
}
