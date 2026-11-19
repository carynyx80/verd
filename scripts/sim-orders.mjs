// Dev helper: places orders on a launch from fresh funded test wallets (localnet/devnet only).
// Usage: node scripts/sim-orders.mjs <LAUNCH_ADDRESS> "6@9" "2@3"   (SOL@tick, tick 0..9)
import fs from "fs";
import anchor from "@anchor-lang/core";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

const [launchAddr, ...orders] = process.argv.slice(2);
if (!launchAddr || !orders.length) { console.error('usage: sim-orders.mjs <LAUNCH> "SOL@tick" ...'); process.exit(1); }
const rpc = process.env.RPC || "http://127.0.0.1:8899";
const connection = new Connection(rpc, "confirmed");
const idl = JSON.parse(fs.readFileSync(new URL("../target/idl/verd.json", import.meta.url)));
const launch = new PublicKey(launchAddr);

for (const o of orders) {
  const [solAmt, tick] = o.split("@").map(Number);
  const buyer = Keypair.generate();
  const sig = await connection.requestAirdrop(buyer.publicKey, (solAmt + 1) * LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
  const program = new anchor.Program(idl, new anchor.AnchorProvider(connection, new anchor.Wallet(buyer), {}));
  await program.methods.placeOrder(new anchor.BN(solAmt * LAMPORTS_PER_SOL), tick)
    .accounts({ launch, buyer: buyer.publicKey }).rpc();
  console.log(`order ${solAmt} SOL @ tick ${tick} from ${buyer.publicKey.toBase58()}`);
}
