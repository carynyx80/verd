// Uniform-price auction maths. Same rules the old on-chain program used, in BigInt so nothing rounds silently.
export const DECIMALS = 6;
export const ONE_TOKEN = 1_000_000n; // 10^DECIMALS
export const NUM_TICKS = 10;
export const BPS = 10_000n;

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b;

export function tickPrice(minPrice: bigint, maxPrice: bigint, tick: number): bigint {
  return minPrice + ((maxPrice - minPrice) * BigInt(tick)) / BigInt(NUM_TICKS - 1);
}

export type Clearing = { tick: number; price: bigint; eligibleBudget: bigint; soldValue: bigint; tokensSold: bigint };

/**
 * Highest price at which demand covers the full sale supply. If even the lowest price
 * can't sell everything, every order fills completely at the minimum price.
 */
export function computeClearing(buckets: bigint[], minPrice: bigint, maxPrice: bigint, saleSupply: bigint): Clearing {
  const total = buckets.reduce((a, b) => a + b, 0n);
  let cum = 0n;
  for (let k = NUM_TICKS - 1; k >= 0; k--) {
    cum += buckets[k];
    const price = tickPrice(minPrice, maxPrice, k);
    if ((cum * ONE_TOKEN) / price >= saleSupply) {
      let soldValue = ceilDiv(saleSupply * price, ONE_TOKEN);
      if (soldValue > cum) soldValue = cum;
      return { tick: k, price, eligibleBudget: cum, soldValue, tokensSold: saleSupply };
    }
  }
  return { tick: 0, price: minPrice, eligibleBudget: total, soldValue: total, tokensSold: (total * ONE_TOKEN) / minPrice };
}

/**
 * (lamports spent, tokens received) for one order. Spend rounds up so refunds can never
 * exceed what's held; token amounts round down so we never mint more than the supply.
 */
export function allocation(budget: bigint, maxTick: number, c: Clearing): { spent: bigint; tokens: bigint } {
  if (c.soldValue === 0n || maxTick < c.tick || c.eligibleBudget === 0n) return { spent: 0n, tokens: 0n };
  let spent = ceilDiv(budget * c.soldValue, c.eligibleBudget);
  if (spent > budget) spent = budget;
  return { spent, tokens: (spent * ONE_TOKEN) / c.price };
}
