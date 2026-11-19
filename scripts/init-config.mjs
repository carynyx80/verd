// One-time platform setup: creates the Verd config account.
// Usage: node scripts/init-config.mjs [--rpc URL] [--fee-bps 200] [--swap-fee-bps 100] [--min-lock-days 90] [--treasury PUBKEY]
import fs from "fs";
import os from "os";
import path from "path";
import anchor from "@anchor-lang/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []));
const rpc = args.rpc || "http://127.0.0.1:8899";
const keyPath = args.keypair || path.join(os.homedir(), ".config/solana/id.json");
const admin = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyPath, "utf8"))));
const idl = JSON.parse(fs.readFileSync(new URL("../target/idl/verd.json", import.meta.url)));
if (args["program-id"]) idl.address = args["program-id"];

const connection = new Connection(rpc, "confirmed");
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(admin), { commitment: "confirmed" });
const program = new anchor.Program(idl, provider);
const [config] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);

const existing = await program.account.config.fetchNullable(config);
if (existing) {
  console.log("Config already exists:", {
    admin: existing.admin.toBase58(), treasury: existing.treasury.toBase58(),
    feeBps: existing.feeBps, swapFeeBps: existing.swapFeeBps, minLockSecs: existing.minLockSecs.toString(),
  });
  process.exit(0);
}
const feeBps = Number(args["fee-bps"] ?? 200);
const swapFeeBps = Number(args["swap-fee-bps"] ?? 100);
const minLockSecs = Math.round(Number(args["min-lock-days"] ?? 0) * 86400);
const treasury = new PublicKey(args.treasury || admin.publicKey);
const sig = await program.methods
  .initConfig(feeBps, swapFeeBps, new anchor.BN(minLockSecs))
  .accounts({ admin: admin.publicKey, treasury })
  .rpc();
console.log(`Config created (${sig})`);
console.log({ program: program.programId.toBase58(), admin: admin.publicKey.toBase58(), treasury: treasury.toBase58(), feeBps, swapFeeBps, minLockSecs });
