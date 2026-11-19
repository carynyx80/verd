import * as anchor from "@anchor-lang/core";
import { Program, BN } from "@anchor-lang/core";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getAccount } from "@solana/spl-token";
import { assert } from "chai";
import { Verd } from "../target/types/verd";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ONE = 1_000_000; // token base units

describe("verd: full agent IPO lifecycle", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.verd as Program<Verd>;
  const conn = provider.connection;

  const treasury = Keypair.generate();
  const creator = Keypair.generate();
  const [alice, bob, carol, dave, trader] = [0, 0, 0, 0, 0].map(() => Keypair.generate());
  const launchId = new BN(Date.now());

  const pda = (seeds: (Buffer | Uint8Array)[]) =>
    PublicKey.findProgramAddressSync(seeds, program.programId)[0];
  const configPda = pda([Buffer.from("config")]);
  const launchPda = pda([Buffer.from("launch"), creator.publicKey.toBuffer(), launchId.toArrayLike(Buffer, "le", 8)]);
  const mintPda = pda([Buffer.from("mint"), launchPda.toBuffer()]);
  const vaultPda = pda([Buffer.from("vault"), launchPda.toBuffer()]);
  const poolSolPda = pda([Buffer.from("pool_sol"), launchPda.toBuffer()]);
  const poolTokensPda = pda([Buffer.from("pool_tokens"), launchPda.toBuffer()]);
  const orderPda = (buyer: PublicKey) => pda([Buffer.from("order"), launchPda.toBuffer(), buyer.toBuffer()]);

  const airdrop = async (pk: PublicKey, sol: number) => {
    const sig = await conn.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
  };

  const expectErr = async (p: Promise<unknown>, code: string) => {
    try {
      await p;
      assert.fail(`expected ${code}`);
    } catch (e: any) {
      assert.include(String(e), code);
    }
  };

  const order = (buyer: Keypair, sol: number, tick: number) =>
    program.methods
      .placeOrder(new BN(sol * LAMPORTS_PER_SOL), tick)
      .accounts({ launch: launchPda, buyer: buyer.publicKey } as any)
      .signers([buyer])
      .rpc();

  before(async () => {
    for (const k of [creator, alice, bob, carol, dave, trader]) await airdrop(k.publicKey, 20);
    await airdrop(treasury.publicKey, 1);
  });

  it("initializes the platform config (2% raise fee, 1% swap fee)", async () => {
    await program.methods
      .initConfig(200, 100, new BN(0))
      .accounts({ admin: provider.wallet.publicKey, treasury: treasury.publicKey } as any)
      .rpc();
    const c = await program.account.config.fetch(configPda);
    assert.equal(c.feeBps, 200);
  });

  it("rejects a creator allocation above 25%", async () => {
    await expectErr(
      program.methods
        .createLaunch(new BN(1), "Greedy", "GRDY", new BN(1000 * ONE), new BN(400 * ONE),
          new BN(1_000_000), new BN(10_000_000), 3000, new BN(1), new BN(5), new BN(0))
        .accounts({ creator: creator.publicKey } as any)
        .signers([creator])
        .rpc(),
      "CreatorShareTooHigh"
    );
  });

  it("files an agent IPO: 1000 tokens, 0.001–0.01 SOL range", async () => {
    await program.methods
      .createLaunch(launchId, "Oracle Agent", "ORCL", new BN(1000 * ONE), new BN(200 * ONE),
        new BN(1_000_000), new BN(10_000_000), 3000, new BN(3), new BN(8), new BN(4))
      .accounts({ creator: creator.publicKey } as any)
      .signers([creator])
      .rpc();
    const l = await program.account.launch.fetch(launchPda);
    assert.equal(l.name, "Oracle Agent");
    assert.isFalse(l.finalized);
  });

  it("blocks orders during the roadshow", async () => {
    await expectErr(order(alice, 1, 9), "BookNotOpen");
  });

  it("collects orders after the roadshow, including a cancellation", async () => {
    await sleep(3500);
    await order(alice, 8, 9); // 8 SOL, will pay up to max
    await order(bob, 4, 9); // 4 SOL, up to max
    await order(carol, 2, 2); // 2 SOL, only up to tick 2 (0.003 SOL)
    await order(dave, 1, 9);
    const before = await conn.getBalance(dave.publicKey);
    await program.methods
      .cancelOrder()
      .accounts({ launch: launchPda, buyer: dave.publicKey } as any)
      .signers([dave])
      .rpc();
    const after = await conn.getBalance(dave.publicKey);
    assert.isAbove(after - before, 0.99 * LAMPORTS_PER_SOL, "dave refunded");
    const l = await program.account.launch.fetch(launchPda);
    assert.equal(l.totalBudget.toNumber(), 14 * LAMPORTS_PER_SOL);
    assert.equal(l.orderCount, 3);
  });

  it("refuses to ring the bell early", async () => {
    await expectErr(
      program.methods.finalize()
        .accounts({ launch: launchPda, creator: creator.publicKey, treasury: treasury.publicKey,
          caller: provider.wallet.publicKey } as any)
        .rpc(),
      "BookStillOpen"
    );
  });

  it("rings the bell: uniform price at max, pro-rata, pool seeded", async () => {
    await sleep(8500);
    const tBefore = await conn.getBalance(treasury.publicKey);
    const cBefore = await conn.getBalance(creator.publicKey);
    await program.methods.finalize()
      .accounts({ launch: launchPda, creator: creator.publicKey, treasury: treasury.publicKey,
        caller: provider.wallet.publicKey } as any)
      .rpc();
    const l = await program.account.launch.fetch(launchPda);
    assert.isTrue(l.finalized);
    assert.equal(l.clearingTick, 9);
    assert.equal(l.clearingPrice.toNumber(), 10_000_000);
    // 12 SOL of eligible demand for 10 SOL worth of supply -> oversubscribed
    assert.equal(l.soldValue.toNumber(), 10 * LAMPORTS_PER_SOL);
    assert.equal(l.eligibleBudget.toNumber(), 12 * LAMPORTS_PER_SOL);
    const tAfter = await conn.getBalance(treasury.publicKey);
    const cAfter = await conn.getBalance(creator.publicKey);
    assert.equal(tAfter - tBefore, 0.2 * LAMPORTS_PER_SOL, "2% fee");
    assert.equal(cAfter - cBefore, 6.8 * LAMPORTS_PER_SOL, "creator gets 68%");
    assert.equal(l.poolSol.toNumber(), 3 * LAMPORTS_PER_SOL, "30% to locked liquidity");
    assert.equal(l.poolTokens.toNumber(), 300 * ONE, "pool priced at clearing price");
  });

  it("allocates pro-rata at the same price and refunds the rest", async () => {
    const claim = (k: Keypair) =>
      program.methods.claim()
        .accounts({ launch: launchPda, buyer: k.publicKey } as any)
        .signers([k]).rpc();
    const aBefore = await conn.getBalance(alice.publicKey);
    await claim(alice);
    await claim(bob);
    const cBefore = await conn.getBalance(carol.publicKey);
    await claim(carol);
    const bal = async (k: Keypair) =>
      Number((await getAccount(conn, getAssociatedTokenAddressSync(mintPda, k.publicKey))).amount);
    const a = await bal(alice), b = await bal(bob), c = await bal(carol);
    // alice 8/12 of 1000, bob 4/12 of 1000
    assert.approximately(a, 666.666 * ONE, ONE);
    assert.approximately(b, 333.333 * ONE, ONE);
    assert.equal(c, 0, "carol's max price was below clearing");
    const aRefund = (await conn.getBalance(alice.publicKey)) - aBefore;
    assert.isAbove(aRefund, 1.3 * LAMPORTS_PER_SOL, "alice refunded ~1.33 SOL");
    const cRefund = (await conn.getBalance(carol.publicKey)) - cBefore;
    assert.isAbove(cRefund, 1.99 * LAMPORTS_PER_SOL, "carol fully refunded");
    // order accounts closed -> no double claim
    await expectErr(claim(alice), "AccountNotInitialized");
  });

  it("vault keeps only dust after all claims (solvency)", async () => {
    const rentMin = await conn.getMinimumBalanceForRentExemption(0);
    const v = await conn.getBalance(vaultPda);
    assert.isAtLeast(v, rentMin);
    assert.isBelow(v - rentMin, 100, "at most rounding dust left");
  });

  it("trades on the locked pool: buy then sell", async () => {
    const ata = getAssociatedTokenAddressSync(mintPda, trader.publicKey);
    const swap = (amt: number, buy: boolean) =>
      program.methods.swap(new BN(amt), new BN(0), buy)
        .accounts({ launch: launchPda, treasury: treasury.publicKey, trader: trader.publicKey } as any)
        .signers([trader]).rpc();
    await swap(0.5 * LAMPORTS_PER_SOL, true);
    const got = Number((await getAccount(conn, ata)).amount);
    assert.isAbove(got, 40 * ONE); // ~42.6 tokens for 0.5 SOL at ~0.01
    let l = await program.account.launch.fetch(launchPda);
    assert.isAbove(l.poolSol.toNumber(), 3 * LAMPORTS_PER_SOL);
    await swap(got, false);
    l = await program.account.launch.fetch(launchPda);
    assert.equal(Number((await getAccount(conn, ata)).amount), 0);
    assert.isAbove(l.volumeSol.toNumber(), 0.9 * LAMPORTS_PER_SOL);
    await expectErr(
      program.methods.swap(new BN(LAMPORTS_PER_SOL), new BN(10_000 * ONE), true)
        .accounts({ launch: launchPda, treasury: treasury.publicKey, trader: trader.publicKey } as any)
        .signers([trader]).rpc(),
      "Slippage"
    );
  });

  it("keeps creator tokens locked, then releases them", async () => {
    const claimCreator = () =>
      program.methods.claimCreator()
        .accounts({ launch: launchPda, creator: creator.publicKey } as any)
        .signers([creator]).rpc();
    await expectErr(claimCreator(), "StillLocked");
    await sleep(4500);
    await claimCreator();
    const bal = Number((await getAccount(conn, getAssociatedTokenAddressSync(mintPda, creator.publicKey))).amount);
    assert.equal(bal, 200 * ONE);
    await expectErr(claimCreator(), "AlreadyClaimed");
  });
});
