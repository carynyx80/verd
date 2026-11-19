// Read-only access to Verd launches on Solana.
import { AnchorProvider, Program } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import idl from "../idl/verd.json" with { type: "json" };

export const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8899";
const PROGRAM_ID = process.env.PROGRAM_ID || (idl as { address: string }).address;

const connection = new Connection(RPC_URL, "confirmed");
const readonlyWallet = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async () => { throw new Error("read-only"); },
  signAllTransactions: async () => { throw new Error("read-only"); },
};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const program = new Program({ ...(idl as any), address: PROGRAM_ID }, new AnchorProvider(connection, readonlyWallet as any, {}));

export type LaunchInfo = { creator: string; name: string; symbol: string; finalized: boolean };

export async function getLaunchOnChain(address: string): Promise<LaunchInfo | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const a: any = await (program.account as any).launch.fetchNullable(new PublicKey(address));
  if (!a) return null;
  return { creator: a.creator.toBase58(), name: a.name, symbol: a.symbol, finalized: a.finalized };
}

export const profileMessage = (launch: string, digest: string) =>
  `Verd: publish agent profile\nlaunch: ${launch}\ndigest: ${digest}`;
