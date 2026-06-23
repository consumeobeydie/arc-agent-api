/**
 * Arc Autonomous Economy Engine v2
 *
 * A self-sustaining agent economy loop:
 * 1. Monitor vault health
 * 2. Open new missions when vault has enough USDC
 * 3. Route mission payouts back into vault
 * 4. Distribute yield to all agents when threshold is reached
 * 5. Repeat
 */

const { createWalletClient, createPublicClient, http, keccak256, toHex, formatUnits } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { initiateDeveloperControlledWalletsClient } = require("@circle-fin/developer-controlled-wallets");
require("dotenv").config();

// ─── Chain Config ────────────────────────────────────────────────────────────
const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  testnet: true,
};

// ─── Contracts ───────────────────────────────────────────────────────────────
const ORCHESTRATOR = "0xe81f5BA4181eA29061C3C229c8D6EB4cFE56639C";
const VAULT        = "0x6C13dA317B65474299F6fDee02daDd6626Eb2BFe";
const USDC         = "0x3600000000000000000000000000000000000000";
const AGENT_B      = "0xa75282Fe398A4Bf910884BDFF29AEb1a23f2E55a";

// ─── Economy Parameters ──────────────────────────────────────────────────────
const MISSION_BUDGET_USDC   = 3_000_000n;   // 3 USDC per mission (6 dec)
const SUB_BUDGET_USDC       = 1_000_000n;   // 1 USDC to Agent B (6 dec)
const MIN_VAULT_FOR_MISSION = 5_000_000n;   // need 5 USDC in vault to open mission
const YIELD_THRESHOLD       = 20_000_000n;  // distribute yield when vault > 20 USDC
const YIELD_AMOUNT          = 2_000_000n;   // 2 USDC yield per distribution
const LOOP_INTERVAL_MS      = 30_000;       // 30 second loop
const MAX_CYCLES            = 3;            // run 3 cycles then exit

// ─── ABIs ────────────────────────────────────────────────────────────────────
const orchAbi = [
  { name: "createMission",  type: "function", stateMutability: "payable",     inputs: [{ name: "description", type: "string" }, { name: "requirement", type: "string" }], outputs: [{ type: "uint256" }] },
  { name: "assignMission",  type: "function", stateMutability: "nonpayable",  inputs: [{ name: "missionId", type: "uint256" }, { name: "agentId", type: "uint256" }],     outputs: [] },
  { name: "hireSubAgent",   type: "function", stateMutability: "nonpayable",  inputs: [{ name: "missionId", type: "uint256" }, { name: "subAgentId", type: "uint256" }, { name: "subBudget", type: "uint256" }], outputs: [] },
  { name: "completeMission",type: "function", stateMutability: "nonpayable",  inputs: [{ name: "missionId", type: "uint256" }, { name: "deliverable", type: "bytes32" }], outputs: [] },
  { name: "getMission",     type: "function", stateMutability: "view",        inputs: [{ name: "missionId", type: "uint256" }], outputs: [{ type: "uint256" }, { type: "address" }, { type: "string" }, { type: "uint256" }, { type: "uint256" }, { type: "uint8" }, { type: "bytes32" }] },
  { name: "missionCount",   type: "function", stateMutability: "view",        inputs: [], outputs: [{ type: "uint256" }] },
  { name: "getAgent",       type: "function", stateMutability: "view",        inputs: [{ name: "agentId", type: "uint256" }], outputs: [{ type: "uint256" }, { type: "address" }, { type: "string" }, { type: "string" }, { type: "uint256" }, { type: "uint256" }, { type: "uint8" }] },
];

const vaultAbi = [
  { name: "depositForAgent", type: "function", stateMutability: "nonpayable", inputs: [{ name: "agent", type: "address" }, { name: "missionId", type: "uint256" }, { name: "amount", type: "uint256" }], outputs: [{ name: "shares", type: "uint256" }] },
  { name: "depositYield",    type: "function", stateMutability: "nonpayable", inputs: [{ name: "amount", type: "uint256" }], outputs: [] },
  { name: "totalAssets",     type: "function", stateMutability: "view",       inputs: [], outputs: [{ type: "uint256" }] },
  { name: "totalSupply",     type: "function", stateMutability: "view",       inputs: [], outputs: [{ type: "uint256" }] },
  { name: "balanceOf",       type: "function", stateMutability: "view",       inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "convertToAssets", type: "function", stateMutability: "view",       inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] },
];

const erc20Abi = [
  { name: "approve",   type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view",       inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
];

// ─── Clients ─────────────────────────────────────────────────────────────────
const account = privateKeyToAccount("0x" + process.env.SELLER_PRIVATE_KEY);
const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http() });
const circleClient = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

// ─── State Reader ─────────────────────────────────────────────────────────────
async function readEconomyState() {
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

// ─── Economy Actions ──────────────────────────────────────────────────────────
async function runMissionCycle(cycleNum) {
  console.log(`\n${"─".repeat(60)}`);
  console.log(`  ECONOMY CYCLE #${cycleNum}`);
  console.log(`${"─".repeat(60)}`);

  const state = await readEconomyState();
  const missionId = state.missionCount;

  console.log(`\n  📊 State:`);
  console.log(`     Vault Assets:    ${state.assets.toString()} USDC`);
  console.log(`     Vault Shares:    ${state.supply.toString()} avUSDC`);
  console.log(`     Agent B Shares:  ${state.agentBShares.toString()} avUSDC`);
  console.log(`     Total Missions:  ${state.missionCount.toString()}`);
  console.log(`     Agent A Rep:     ${state.agentA[4].toString()}`);
  console.log(`     Agent B Rep:     ${state.agentB[4].toString()}`);
  console.log(`     Wallet USDC:     ${state.walletBalance.toString()}`);

  // Check if we have enough to open a mission
  if (state.walletBalance < MISSION_BUDGET_USDC) {
    console.log(`\n  ⚠️  Insufficient wallet USDC for new mission. Skipping cycle.`);
    return null;
  }

  console.log(`\n  🚀 Opening Mission #${missionId}...`);

  // 1. Create mission (native USDC value = budget in 18 dec)
  const MISSION_BUDGET_18 = MISSION_BUDGET_USDC * 1_000_000_000_000n; // 6→18 dec
  const SUB_BUDGET_18 = SUB_BUDGET_USDC * 1_000_000_000_000n;

  await tx("Create mission", () => walletClient.writeContract({
    address: ORCHESTRATOR, abi: orchAbi, functionName: "createMission",
    args: [`Economy Engine Mission #${missionId} Cycle #${cycleNum}`, "autonomous,yield,economy"],
    value: MISSION_BUDGET_18, account,
  }));

  // 2. Assign to Agent A
  await tx("Assign to Agent A", () => walletClient.writeContract({
    address: ORCHESTRATOR, abi: orchAbi, functionName: "assignMission",
    args: [missionId, 0n], account,
  }));

  // 3. Agent A hires Agent B
  await tx("Agent A hires Agent B", () => walletClient.writeContract({
    address: ORCHESTRATOR, abi: orchAbi, functionName: "hireSubAgent",
    args: [missionId, 1n, SUB_BUDGET_18], account,
  }));

  // 4. Fund Agent B for gas
  const fundTx = await circleClient.createTransaction({
    walletAddress: process.env.CIRCLE_WALLET_ADDRESS,
    blockchain: "ARC-TESTNET",
    tokenAddress: USDC,
    destinationAddress: AGENT_B,
    amount: ["1"],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  await waitForCircleTx(fundTx.data?.id, "Fund Agent B");

  // 5. Agent B completes mission
  const deliverable = keccak256(toHex(`economy-mission-${missionId}-cycle-${cycleNum}`));
  const completeTx = await circleClient.createContractExecutionTransaction({
    walletAddress: AGENT_B,
    blockchain: "ARC-TESTNET",
    contractAddress: ORCHESTRATOR,
    abiFunctionSignature: "completeMission(uint256,bytes32)",
    abiParameters: [missionId.toString(), deliverable],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  await waitForCircleTx(completeTx.data?.id, "Agent B completes mission");

  // 6. Deposit Agent B's payout into vault
  await tx("Approve USDC for vault", () => walletClient.writeContract({
    address: USDC, abi: erc20Abi, functionName: "approve",
    args: [VAULT, SUB_BUDGET_USDC], account,
  }));

  const depositHash = await tx("Deposit payout into vault", () => walletClient.writeContract({
    address: VAULT, abi: vaultAbi, functionName: "depositForAgent",
    args: [AGENT_B, missionId, SUB_BUDGET_USDC], account,
  }));

  // 7. Check yield threshold
  const newState = await readEconomyState();
  if (newState.assets >= YIELD_THRESHOLD) {
    console.log(`\n  💰 Yield threshold reached! Distributing yield...`);
    await tx("Approve yield", () => walletClient.writeContract({
      address: USDC, abi: erc20Abi, functionName: "approve",
      args: [VAULT, YIELD_AMOUNT], account,
    }));
    await tx("Deposit yield", () => walletClient.writeContract({
      address: VAULT, abi: vaultAbi, functionName: "depositYield",
      args: [YIELD_AMOUNT], account,
    }));
  }

  // 8. Final state
  const finalState = await readEconomyState();
  console.log(`\n  ✅ Cycle #${cycleNum} complete!`);
  console.log(`     Vault Assets:    ${finalState.assets.toString()} USDC`);
  console.log(`     Agent B Shares:  ${finalState.agentBShares.toString()} avUSDC`);
  console.log(`     Agent A Rep:     ${finalState.agentA[4].toString()}`);
  console.log(`     Agent B Rep:     ${finalState.agentB[4].toString()}`);

  return missionId;
}

// ─── Main Loop ────────────────────────────────────────────────────────────────
async function main() {
  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║     ARC AUTONOMOUS ECONOMY ENGINE v2                      ║");
  console.log("║     Orchestrator + Vault + Auto-compounding Yield         ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log(`\n  Owner:       ${account.address}`);
  console.log(`  Orchestrator: ${ORCHESTRATOR}`);
  console.log(`  Vault:        ${VAULT}`);
  console.log(`  Cycles:       ${MAX_CYCLES}`);
  console.log(`  Interval:     ${LOOP_INTERVAL_MS / 1000}s\n`);

  for (let cycle = 1; cycle <= MAX_CYCLES; cycle++) {
    try {
      await runMissionCycle(cycle);
    } catch (err) {
      console.error(`\n  ❌ Cycle #${cycle} error:`, err.shortMessage || err.message);
    }

    if (cycle < MAX_CYCLES) {
      console.log(`\n  ⏳ Waiting ${LOOP_INTERVAL_MS / 1000}s before next cycle...`);
      await sleep(LOOP_INTERVAL_MS);
    }
  }

  console.log("\n╔════════════════════════════════════════════════════════════╗");
  console.log("║     ECONOMY ENGINE COMPLETE                               ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");

  const final = await readEconomyState();
  console.log(`  Final Vault Assets:   ${final.assets.toString()} USDC`);
  console.log(`  Final Vault Supply:   ${final.supply.toString()} avUSDC`);
  console.log(`  Agent B Shares:       ${final.agentBShares.toString()} avUSDC`);
  console.log(`  Total Missions:       ${final.missionCount.toString()}`);
  console.log(`  Agent A Reputation:   ${final.agentA[4].toString()}`);
  console.log(`  Agent B Reputation:   ${final.agentB[4].toString()}`);
  console.log(`\n  Explorer: https://testnet.arcscan.app/address/${VAULT}`);
}

main().catch(console.error);