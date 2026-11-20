// Solana connection, the company wallet, and once-only payment sending.
//
// The company wallet's private key is never needed by this server. Outgoing payments are built
// here and signed either by an admin in their browser wallet (default), or, only if the operator
// explicitly configures COMPANY_WALLET_SECRET for that same address, automatically on the server.
import {
  ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction,
  TransactionInstruction, VersionedTransaction, type Signer,
} from "@solana/web3.js";
import bs58 from "bs58";

export const NETWORK = process.env.SOLANA_NETWORK || "mainnet-beta";
const DEFAULT_RPC: Record<string, string> = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
  localnet: "http://127.0.0.1:8899",
};
export const RPC_URL = process.env.RPC_URL || DEFAULT_RPC[NETWORK] || DEFAULT_RPC["mainnet-beta"];
export const connection = new Connection(RPC_URL, "confirmed");

export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
export const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

function parseKey(name: string): PublicKey | null {
  const v = (process.env[name] || "").trim();
  if (!v) return null;
  try { return new PublicKey(v); } catch { console.error(`${name} is not a valid Solana address`); return null; }
}

/** The company wallet: receives orders and filing fees, pays refunds, holds mint authority. */
export const COMPANY = parseKey("COMPANY_WALLET_ADDRESS");
/** Where platform fees and the creator's share are accounted from. Defaults to the company wallet. */
export const TREASURY = parseKey("TREASURY_ADDRESS") ?? COMPANY;

/** Optional automatic signer. Ignored unless it is exactly the company wallet. */
function loadServerSigner(): Keypair | null {
  const raw = (process.env.COMPANY_WALLET_SECRET || "").trim();
  if (!raw || !COMPANY) return null;
  try {
    const kp = Keypair.fromSecretKey(raw.startsWith("[") ? Uint8Array.from(JSON.parse(raw)) : bs58.decode(raw));
    if (!kp.publicKey.equals(COMPANY)) {
      console.error("COMPANY_WALLET_SECRET does not belong to COMPANY_WALLET_ADDRESS; automatic payouts stay off");
      return null;
    }
    return kp;
  } catch {
    console.error("COMPANY_WALLET_SECRET is not a valid secret key; automatic payouts stay off");
    return null;
  }
}
export const serverSigner = loadServerSigner();

export function requireCompany(): PublicKey {
  if (!COMPANY) throw new Error("COMPANY_WALLET_ADDRESS is not configured on the server");
  return COMPANY;
}

export const memoIx = (text: string) =>
  new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(text, "utf8") });

// ───── Metaplex token metadata (name, ticker, logo in wallets) ─────

export const metadataPda = (mint: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()], METADATA_PROGRAM_ID)[0];

const borshString = (s: string) => {
  const b = Buffer.from(s, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(b.length);
  return Buffer.concat([len, b]);
};

/** CreateMetadataAccountV3, encoded by hand so we don't pull in the whole Metaplex SDK. */
export function createMetadataIx(p: { mint: PublicKey; mintAuthority: PublicKey; payer: PublicKey; updateAuthority: PublicKey; name: string; symbol: string; uri: string }) {
  const data = Buffer.concat([
    Buffer.from([33]), // CreateMetadataAccountV3
    borshString(p.name), borshString(p.symbol), borshString(p.uri),
    Buffer.from([0, 0]), // seller_fee_basis_points = 0
    Buffer.from([0, 0, 0]), // creators, collection, uses: None
    Buffer.from([1]), // is_mutable
    Buffer.from([0]), // collection_details: None
  ]);
  return new TransactionInstruction({
    programId: METADATA_PROGRAM_ID,
    keys: [
      { pubkey: metadataPda(p.mint), isSigner: false, isWritable: true },
      { pubkey: p.mint, isSigner: false, isWritable: false },
      { pubkey: p.mintAuthority, isSigner: true, isWritable: false },
      { pubkey: p.payer, isSigner: true, isWritable: true },
      { pubkey: p.updateAuthority, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ───── once-only sending ─────

/**
 * State for one outgoing payment. The signature is saved *before* the transaction is broadcast,
 * so after a crash we check that signature instead of paying twice.
 */
export type SendState = {
  sig?: string;
  lastValidBlockHeight?: number;
  /** base64 message handed to an admin to sign; only that exact message is accepted back */
  awaiting?: string;
  attempts?: number;
  error?: string;
};

/** Is an earlier attempt finished, still in flight, or safe to rebuild? */
export async function checkSent(state: SendState): Promise<"done" | "pending" | "retry"> {
  if (state.sig) {
    const st = (await connection.getSignatureStatuses([state.sig], { searchTransactionHistory: true })).value[0];
    if (st && !st.err && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return "done";
    if (st?.err) {
      state.error = `failed on-chain: ${JSON.stringify(st.err)}`.slice(0, 300);
      state.sig = undefined; // nothing moved
      return "retry";
    }
    const height = await connection.getBlockHeight("confirmed");
    if (height <= (state.lastValidBlockHeight ?? 0)) return "pending";
    const again = (await connection.getSignatureStatuses([state.sig], { searchTransactionHistory: true })).value[0];
    if (again && !again.err) return again.confirmationStatus === "processed" ? "pending" : "done";
    state.sig = undefined; // expired without landing
    return "retry";
  }
  if (state.awaiting) {
    const height = await connection.getBlockHeight("confirmed");
    if (height <= (state.lastValidBlockHeight ?? 0)) return "pending"; // admin may still sign it
    state.awaiting = undefined;
  }
  return "retry";
}

export type Built = { ixs: TransactionInstruction[]; signers?: Signer[] };

/** Builds and simulates a company-paid transaction. Throws with the program logs if it would fail. */
export async function buildTx({ ixs, signers = [] }: Built): Promise<{ tx: Transaction; lastValidBlockHeight: number }> {
  const payer = requireCompany();
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: payer, blockhash, lastValidBlockHeight });
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: Number(process.env.PRIORITY_MICROLAMPORTS || 20_000) }), ...ixs);
  const sim = await connection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), { sigVerify: false });
  if (sim.value.err) {
    throw new Error(`${JSON.stringify(sim.value.err)} ${(sim.value.logs ?? []).slice(-4).join(" | ")}`.slice(0, 500));
  }
  if (signers.length) tx.partialSign(...signers);
  return { tx, lastValidBlockHeight };
}

/** Records the signature, saves, then broadcasts. `tx` must carry a valid company signature. */
export async function broadcast(state: SendState, tx: Transaction, lastValidBlockHeight: number, persist: () => Promise<void>) {
  const payer = requireCompany();
  const sig = tx.signatures.find((s) => s.publicKey.equals(payer))?.signature;
  if (!sig || !tx.verifySignatures()) throw new Error("Transaction is not fully signed by the company wallet");
  state.sig = bs58.encode(sig);
  state.lastValidBlockHeight = lastValidBlockHeight;
  state.awaiting = undefined;
  state.attempts = (state.attempts ?? 0) + 1;
  state.error = undefined;
  await persist();
  await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 5 });
}
