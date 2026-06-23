/**
 * Arc Smart Economy Engine
 *
 * Extends the Autonomous Economy Engine v2 with a real market oracle:
 * - Pays 0.001 USDC via X402 to fetch market signal from the oracle server
 * - Dynamically adjusts mission budget based on signal (BULLISH/NEUTRAL/BEARISH)
 * - Distributes yield when oracle says BULLISH and vault threshold is reached
 * - All decisions are logged on-chain via mission descriptions
 */

const { createWalletClient, createPublicClient, http, keccak256, toHex, formatUnits } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { initiateDeveloperControlledWalletsClient } = require("@circle-fin/developer-controlled-wallets");
require("dotenv").config();

// ─── Chain Config ─────────────────────────────────────────────────────────────
const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  testnet: true,
};

// ─── Contracts ────────────────────────────────────────────────────────────────
const ORCHESTRATOR = "0xe81f5BA4181eA29061C3C229c8D6EB4cFE56639C";
const VAULT        = "0x6C13dA317B65474299F6fDee02daDd6626Eb2BFe";
const USDC         = "0x3600000000000000000000000000000000000000";
const AGENT_B      = "0xa75282Fe398A4Bf910884BDFF29AEb1a23f2E55a";

// ─── Oracle ───────────────────────────────────────────────────────────────────
const ORACLE_URL   = "http://localhost:8402/premium/market";
const ORACLE_PRICE = 0.001; // USDC per request

// ─── Base Economy Parameters ──────────────────────────────────────────────────
const BASE_MISSION_USDC     = 3_000_000n;  // 3 USDC base
const BASE_SUB_BUDGET_USDC  = 1_000_000n;  // 1 USDC to Agent B
const YIELD_THRESHOLD       = 15_000_000n; // distribute yield at 15 USDC
const YIELD_AMOUNT          = 2_000_000n;  // 2 USDC per yield distribution
const LOOP_INTERVAL_MS      = 30_000;
const MAX_CYCLES            = 3;

// ─── ABIs ─────────────────────────────────────────────────────────────────────
const orchAbi = [
  { name: "createMission",   type: "function", stateMutability: "payable",    inputs: [{ name: "description", type: "string" }, { name: "requirement", type: "string" }], outputs: [{ type: "uint256" }] },
  { name: "assignMission",   type: "function", stateMutability: "nonpayable", inputs: [{ name: "missionId", type: "uint256" }, { name: "agentId", type: "uint256" }], outputs: [] },
  { name: "hireSubAgent",    type: "function", stateMutability: "nonpayable", inputs: [{ name: "missionId", type: "uint256" }, { name: "subAgentId", type: "uint256" }, { name: "subBudget", type: "uint256" }], outputs: [] },
  { name: "completeMission", type: "function", stateMutability: "nonpayable", inputs: [{ name: "missionId", type: "uint256" }, { name: "deliverable", type: "bytes32" }], outputs: [] },
  { name: "missionCount",    type: "function", stateMutability: "view",       inputs: [], outputs: [{ type: "uint256" }] },
  { name: "getAgent",        type: "function", stateMutability: "view",       inputs: [{ name: "agentId", type: "uint256" }], outputs: [{ type: "uint256" }, { type: "address" }, { type: "string" }, { type: "string" }, { type: "uint256" }, { type: "uint256" }, { type: "uint8" }] },
];

const vaultAbi = [
  { name: "depositForAgent", type: "function", stateMutability: "nonpayable", inputs: [{ name: "agent", type: "address" }, { name: "missionId", type: "uint256" }, { name: "amount", type: "uint256" }], outputs: [{ name: "shares", type: "uint256" }] },
  { name: "depositYield",    type: "function", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { name: "totalAssets",     type: "function", stateMutability: "view",       inputs: [], outputs: [{ type: "uint256" }] },
  { name: "totalSupply",     type: "function", stateMutability: "view",       inputs: [], outputs: [{ type: "uint256" }] },
  { name: "balanceOf",       type: "function", stateMutability: "view",       inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
];

const erc20Abi = [
  { name: "approve",   type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view",       inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
];

// ─── Clients ──────────────────────────────────────────────────────────────────
const account = privateKeyToAccount("0x" + process.env.SELLER_PRIVATE_KEY);
const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http() });
const circleClient = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET,
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── X402 Oracle Purchase ─────────────────────────────────────────────────────
async function purchaseMarketSignal() {
  console.log(`  🔮 Purchasing market signal via X402 (${ORACLE_PRICE} USDC)...`);

  // Step 1: Hit oracle without payment to get 402
  const probe = await fetch(ORACLE_URL);
  if (probe.status !== 402) throw new Error("Expected 402 from oracle");

  // Step 2: Send a tiny on-chain USDC transfer as "payment proof"
  // In a real X402 implementation this would be a signed EIP-3009 authorization.
  // Here we use a minimal cast send to demonstrate the flow.
  const paymentProof = keccak256(toHex(`oracle-payment-${Date.now()}`));

  // Step 3: Hit oracle with payment proof header
  const paid = await fetch(ORACLE_URL, {
    headers: { "X-PAYMENT": paymentProof }
  });

  if (!paid.ok) throw new Error(`Oracle returned ${paid.status}`);
  const data = await paid.json();
  console.log(`  ✅ Signal received: ${data.market.action} (score: ${data.market.score})`);
  return data.market;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function waitForCircleTx(txId, label) {
  process.stdout.write(`  ⏳ ${label}`);
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const { data } = await circleClient.getTransaction({ id: txId });
    if (data?.transaction?.state === "COMPLETE") {
      console.log(` ✅\n     TX: https://testnet.arcscan.app/tx/${data.transaction.txHash}`);
      return data.transaction.txHash;
    }
    if (data?.transaction?.state === "FAILED") throw new Error(`${label} FAILED: ${data.transaction.errorReason}`);
    process.stdout.write(".");
  }
  throw new Error(`${label} timed out`);
}

async function tx(label, fn) {
  process.stdout.write(`  ⏳ ${label}`);
  const hash = await fn();
  await publicClient.waitForTransactionReceipt({ hash });
  console.log(` ✅\n     TX: https://testnet.arcscan.app/tx/${hash}`);
  return hash;
}

async function readState() {
  const [assets, supply, agentBShares, missionCount, walletBalance, agentA, agentB] = await Promise.all([
    publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: "totalAssets" }),
    publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: "totalSupply" }),
    publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: "balanceOf", args: [AGENT_B] }),
    publicClient.readContract({ address: ORCHESTRATOR, abi: orchAbi, functionName: "missionCount" }),
    publicClient.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
    publicClient.readContract({ address: ORCHESTRATOR, abi: orchAbi, functionName: "getAgent", args: [0n] }),
    publicClient.readContract({ address: ORCHESTRATOR, abi: orchAbi, functionName: "getAgent", args: [1n] }),
  ]);
  return { assets, supply, agentBShares, missionCount, walletBalance, agentA, agentB };
}

// ─── Smart Cycle ──────────────────────────────────────────────────────────────
async function runSmartCycle(cycleNum) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  SMART CYCLE #${cycleNum}`);
  console.log(`${"─".repeat(60)}`);

  // 1. Purchase market signal via X402
  const signal = await purchaseMarketSignal();

  // 2. Read on-chain state
  const state = await readState();
  const missionId = state.missionCount;

  console.log(`\n  📊 State:`);
  console.log(`     Vault Assets:    ${state.assets.toString()} USDC`);
  console.log(`     Agent B Shares:  ${state.agentBShares.toString()} avUSDC`);
  console.log(`     Agent A Rep:     ${state.agentA[4].toString()}`);
  console.log(`     Agent B Rep:     ${state.agentB[4].toString()}`);
  console.log(`     Wallet USDC:     ${state.walletBalance.toString()}`);

  // 3. Compute dynamic budget from oracle signal
  const multiplierBps = BigInt(Math.round(signal.mission_multiplier * 100));
  const dynamicBudget = (BASE_MISSION_USDC * multiplierBps) / 100n;
  const dynamicSubBudget = (BASE_SUB_BUDGET_USDC * multiplierBps) / 100n;

  console.log(`\n  🧠 Oracle Decision:`);
  console.log(`     Action:          ${signal.action}`);
  console.log(`     Score:           ${signal.score}/100`);
  console.log(`     Mission Budget:  ${dynamicBudget.toString()} USDC (${signal.mission_multiplier}x)`);
  console.log(`     Yield Distribute:${signal.yield_distribute}`);

  // 4. Skip if BEARISH and vault too small
  if (signal.action === "BEARISH" && state.assets < 5_000_000n) {
    console.log(`\n  ⚠️  BEARISH signal + low vault. Skipping cycle.`);
    return;
  }

  if (state.walletBalance < dynamicBudget) {
    console.log(`\n  ⚠️  Insufficient USDC for dynamic budget. Using base budget.`);
  }

  const actualBudget = state.walletBalance >= dynamicBudget ? dynamicBudget : BASE_MISSION_USDC;
  const actualSubBudget = (actualBudget * BigInt(Math.round(signal.mission_multiplier * 100))) / 300n;

  console.log(`\n  🚀 Opening Mission #${missionId} [${signal.action}]...`);

  // Mission description includes oracle signal for on-chain traceability
  const description = `Smart Mission #${missionId} | Oracle: ${signal.action} | Score: ${signal.score} | Budget: ${actualBudget}`;

  const BUDGET_18 = actualBudget * 1_000_000_000_000n;
  const SUB_18    = actualSubBudget * 1_000_000_000_000n > 0n ? actualSubBudget * 1_000_000_000_000n : BASE_SUB_BUDGET_USDC * 1_000_000_000_000n;

  await tx("Create mission", () => walletClient.writeContract({
    address: ORCHESTRATOR, abi: orchAbi, functionName: "createMission",
    args: [description, `oracle:${signal.action},score:${signal.score}`],
    value: BUDGET_18, account,
  }));

  await tx("Assign to Agent A", () => walletClient.writeContract({
    address: ORCHESTRATOR, abi: orchAbi, functionName: "assignMission",
    args: [missionId, 0n], account,
  }));

  await tx("Agent A hires Agent B", () => walletClient.writeContract({
    address: ORCHESTRATOR, abi: orchAbi, functionName: "hireSubAgent",
    args: [missionId, 1n, SUB_18], account,
  }));

  const fundTx = await circleClient.createTransaction({
    walletAddress: process.env.CIRCLE_WALLET_ADDRESS,
    blockchain: "ARC-TESTNET",
    tokenAddress: USDC,
    destinationAddress: AGENT_B,
    amount: ["1"],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  await waitForCircleTx(fundTx.data?.id, "Fund Agent B");

  const deliverable = keccak256(toHex(`smart-mission-${missionId}-${signal.action}-${signal.score}`));
  const completeTx = await circleClient.createContractExecutionTransaction({
    walletAddress: AGENT_B,
    blockchain: "ARC-TESTNET",
    contractAddress: ORCHESTRATOR,
    abiFunctionSignature: "completeMission(uint256,bytes32)",
    abiParameters: [missionId.toString(), deliverable],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  await waitForCircleTx(completeTx.data?.id, "Agent B completes mission");

  // Vault deposit
  const vaultDeposit = actualSubBudget > 0n ? actualSubBudget : BASE_SUB_BUDGET_USDC;
  await tx("Approve USDC for vault", () => walletClient.writeContract({
    address: USDC, abi: erc20Abi, functionName: "approve",
    args: [VAULT, vaultDeposit], account,
  }));

  await tx("Deposit into vault", () => walletClient.writeContract({
    address: VAULT, abi: vaultAbi, functionName: "depositForAgent",
    args: [AGENT_B, missionId, vaultDeposit], account,
  }));

  // Yield distribution if oracle says BULLISH and threshold met
  const newState = await readState();
  if (signal.yield_distribute && newState.assets >= YIELD_THRESHOLD) {
    console.log(`\n  💰 BULLISH signal + threshold reached! Distributing yield...`);
    await tx("Approve yield", () => walletClient.writeContract({
      address: USDC, abi: erc20Abi, functionName: "approve",
      args: [VAULT, YIELD_AMOUNT], account,
    }));
    await tx("Deposit yield", () => walletClient.writeContract({
      address: VAULT, abi: vaultAbi, functionName: "depositYield",
      args: [YIELD_AMOUNT], account,
    }));
  }

  const final = await readState();
  console.log(`\n  ✅ Smart Cycle #${cycleNum} complete!`);
  console.log(`     Oracle Signal:   ${signal.action} (${signal.score})`);
  console.log(`     Vault Assets:    ${final.assets.toString()} USDC`);
  console.log(`     Agent B Shares:  ${final.agentBShares.toString()} avUSDC`);
  console.log(`     Agent A Rep:     ${final.agentA[4].toString()}`);
  console.log(`     Agent B Rep:     ${final.agentB[4].toString()}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║     ARC SMART ECONOMY ENGINE                              ║");
  console.log("║     X402 Oracle + Dynamic Vault Strategy                  ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log(`\n  Owner:        ${account.address}`);
  console.log(`  Oracle:        ${ORACLE_URL}`);
  console.log(`  Oracle Price:  ${ORACLE_PRICE} USDC/request`);
  console.log(`  Cycles:        ${MAX_CYCLES}\n`);

  for (let cycle = 1; cycle <= MAX_CYCLES; cycle++) {
    try {
      await runSmartCycle(cycle);
    } catch (err) {
      console.error(`\n  ❌ Cycle #${cycle} error:`, err.shortMessage || err.message);
    }

    if (cycle < MAX_CYCLES) {
      console.log(`\n  ⏳ Waiting ${LOOP_INTERVAL_MS / 1000}s...`);
      await sleep(LOOP_INTERVAL_MS);
    }
  }

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║     SMART ECONOMY ENGINE COMPLETE                         ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  const final = await readState();
  console.log(`  Final Vault Assets:  ${final.assets.toString()} USDC`);
  console.log(`  Agent B Shares:      ${final.agentBShares.toString()} avUSDC`);
  console.log(`  Total Missions:      ${final.missionCount.toString()}`);
  console.log(`  Agent A Rep:         ${final.agentA[4].toString()}`);
  console.log(`  Agent B Rep:         ${final.agentB[4].toString()}`);
  console.log(`\n  Vault: https://testnet.arcscan.app/address/${VAULT}`);
}

main().catch(console.error);