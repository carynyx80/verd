// Trading after the bell runs on Meteora DAMM v2, an existing audited Solana AMM (same program id on
// mainnet and devnet). Each listing gets a TOKEN/SOL pool seeded at the IPO price, and the whole
// position is permanently locked at creation, so nobody (including Sipt) can withdraw it.
import {
  ActivationType, BaseFeeMode, CollectFeeMode, CpAmm, MAX_SQRT_PRICE, MIN_SQRT_PRICE, deriveCustomizablePoolAddress,
  getBaseFeeParams, getSqrtPriceFromPrice,
} from "@meteora-ag/cp-amm-sdk";
import { NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import BN from "bn.js";
import { connection, requireCompany, type Built } from "./solana.js";

const cpAmm = new CpAmm(connection);
export const SWAP_FEE_BPS = Number(process.env.SWAP_FEE_BPS || 100);

export const poolAddress = (mint: PublicKey) => deriveCustomizablePoolAddress(mint, NATIVE_MINT);

/** Pool creation: the company wallet deposits `tokens` + `lamports` at `priceLamports` per whole token. */
export async function buildCreatePool(p: { mint: PublicKey; tokens: bigint; lamports: bigint; priceLamports: bigint; positionNft: Keypair }): Promise<Built> {
  const company = requireCompany();
  const price = (Number(p.priceLamports) / 1e9).toString(); // SOL per whole token
  const initSqrtPrice = getSqrtPriceFromPrice(price, 6, 9);
  const prepared = cpAmm.preparePoolCreationParams({
    tokenAAmount: new BN(p.tokens.toString()),
    tokenBAmount: new BN(p.lamports.toString()),
    minSqrtPrice: MIN_SQRT_PRICE,
    maxSqrtPrice: MAX_SQRT_PRICE,
    collectFeeMode: CollectFeeMode.OnlyB,
  });
  const { tx } = await cpAmm.createCustomPool({
    payer: company,
    creator: company,
    positionNft: p.positionNft.publicKey,
    tokenAMint: p.mint,
    tokenBMint: NATIVE_MINT,
    tokenAAmount: new BN(p.tokens.toString()),
    tokenBAmount: new BN(p.lamports.toString()),
    sqrtMinPrice: MIN_SQRT_PRICE,
    sqrtMaxPrice: MAX_SQRT_PRICE,
    liquidityDelta: prepared.liquidityDelta,
    initSqrtPrice: prepared.initSqrtPrice ?? initSqrtPrice,
    poolFees: {
      baseFee: getBaseFeeParams({
        baseFeeMode: BaseFeeMode.FeeTimeSchedulerLinear,
        feeTimeSchedulerParam: { startingFeeBps: SWAP_FEE_BPS, endingFeeBps: SWAP_FEE_BPS, numberOfPeriod: 0, totalDuration: 0 },
      }),
      compoundingFeeBps: 0,
      padding: 0,
      dynamicFee: null,
    },
    hasAlphaVault: false,
    activationType: ActivationType.Timestamp,
    collectFeeMode: CollectFeeMode.OnlyB, // trading fees accrue in SOL to the locked position's owner
    activationPoint: null,
    tokenAProgram: TOKEN_PROGRAM_ID,
    tokenBProgram: TOKEN_PROGRAM_ID,
    isLockLiquidity: true,
  });
  const ixs = tx.instructions.filter((ix) => !ix.programId.equals(new PublicKey("ComputeBudget111111111111111111111111111111")));
  return { ixs, signers: [p.positionNft] };
}

export type PoolInfo = { address: string; sol: number; tokens: number; price: number };

const poolCache = new Map<string, { at: number; info: PoolInfo | null }>();

/** Current reserves, cached for 10s. `price` is lamports per whole token. */
export async function getPool(mint: string): Promise<PoolInfo | null> {
  const hit = poolCache.get(mint);
  if (hit && Date.now() - hit.at < 10_000) return hit.info;
  let info: PoolInfo | null = null;
  try {
    const pool = poolAddress(new PublicKey(mint));
    const st = await cpAmm.fetchPoolState(pool);
    const [a, b] = await Promise.all([connection.getTokenAccountBalance(st.tokenAVault), connection.getTokenAccountBalance(st.tokenBVault)]);
    const tokens = Number(a.value.amount), sol = Number(b.value.amount);
    const sp = Number(st.sqrtPrice.toString()) / 2 ** 64;
    info = { address: pool.toBase58(), sol, tokens, price: sp * sp * 1e6 };
  } catch {
    info = null;
  }
  poolCache.set(mint, { at: Date.now(), info });
  return info;
}

/** Quote and an unsigned swap transaction for the trader's own wallet to sign. Sipt never holds the trader's funds. */
export async function buildSwap(p: { mint: string; trader: string; buy: boolean; amountIn: bigint; slippageBps: number }) {
  const mint = new PublicKey(p.mint), trader = new PublicKey(p.trader);
  const pool = poolAddress(mint);
  const poolState = await cpAmm.fetchPoolState(pool);
  const slot = await connection.getSlot("confirmed");
  const time = (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
  const inputMint = p.buy ? NATIVE_MINT : mint;
  const quote = cpAmm.getQuote({
    inAmount: new BN(p.amountIn.toString()),
    inputTokenMint: inputMint,
    slippage: p.slippageBps / 100,
    poolState,
    currentTime: time,
    currentSlot: slot,
    tokenADecimal: 6,
    tokenBDecimal: 9,
  });
  const tx: Transaction = await cpAmm.swap({
    payer: trader,
    pool,
    inputTokenMint: inputMint,
    outputTokenMint: p.buy ? mint : NATIVE_MINT,
    amountIn: new BN(p.amountIn.toString()),
    minimumAmountOut: quote.minSwapOutAmount,
    tokenAMint: poolState.tokenAMint,
    tokenBMint: poolState.tokenBMint,
    tokenAVault: poolState.tokenAVault,
    tokenBVault: poolState.tokenBVault,
    tokenAProgram: TOKEN_PROGRAM_ID,
    tokenBProgram: TOKEN_PROGRAM_ID,
    referralTokenAccount: null,
    poolState,
  });
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  tx.feePayer = trader;
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  return {
    out: quote.swapOutAmount.toString(),
    minOut: quote.minSwapOutAmount.toString(),
    fee: quote.totalFee.toString(),
    priceImpact: Number(quote.priceImpact.toString()),
    tx: tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64"),
  };
}
