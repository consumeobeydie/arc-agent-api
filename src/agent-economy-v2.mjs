/**
 * Arc Agent Economy v2 — Full Integration
 * ERC-8004 + SpendingLimits + SplitPayment + Memo + x402
 */
import { createWalletClient, createPublicClient, http, encodeFunctionData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import * as dotenv from "dotenv";
dotenv.config();

BigInt.prototype.toJSON = function() { return this.toString(); };

const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  testnet: true,
};

// Contract addresses
const AGENT_IDENTITY  = "0x5275783cD74eC21739Af8f3be9c42C024F671cFb";
const SPENDING_LIMITS = "0x615a4B25448980a6b518f9F9088C206387535192";
const SPLIT_PAYMENT   = "0x775D4DF117f0B63a16ade4185bDa221Adcb4AEA3";
const EVENT_LOGGER    = "0x9C50765e591663ED541B2fB863626f39fC6C12e0";
const MEMO_PRECOMPILE = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505";

// ABIs
const agentIdentityAbi = [
  { name: "recordMission", type: "function", stateMutability: "nonpayable", inputs: [{ name: "agentId", type: "uint256" }, { name: "success", type: "bool" }], outputs: [] },
  { name: "submitFeedback", type: "function", stateMutability: "nonpayable", inputs: [{ name: "agentId", type: "uint256" }, { name: "score", type: "int8" }, { name: "comment", type: "string" }], outputs: [] },
  { name: "getSuccessRate", type: "function", stateMutability: "view", inputs: [{ name: "agentId", type: "uint256" }], outputs: [{ type: "uint256" }] },
];

const spendingLimitsAbi = [
  { name: "setLimit", type: "function", stateMutability: "nonpayable", inputs: [{ name: "agent", type: "address" }, { name: "dailyLimit", type: "uint256" }, { name: "weeklyLimit", type: "uint256" }, { name: "perTxLimit", type: "uint256" }], outputs: [] },
  { name: "canSpend", type: "function", stateMutability: "view", inputs: [{ name: "agent", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }, { type: "string" }] },
  { name: "recordSpend", type: "function", stateMutability: "nonpayable", inputs: [{ name: "agent", type: "address" }, { name: "amount", type: "uint256" }], outputs: [] },
  { name: "remainingDaily", type: "function", stateMutability: "view", inputs: [{ name: "agent", type: "address" }], outputs: [{ type: "uint256" }] },
];

const splitPaymentAbi = [
  { name: "createSplit", type: "function", stateMutability: "nonpayable", inputs: [{ name: "name", type: "string" }, { name: "wallets", type: "address[]" }, { name: "sharesBps", type: "uint256[]" }, { name: "labels", type: "string[]" }], outputs: [{ name: "splitId", type: "uint256" }] },
  { name: "distribute", type: "function", stateMutability: "payable", inputs: [{ name: "splitId", type: "uint256" }], outputs: [] },
];

const eventLoggerAbi = [
  { name: "logMessage", type: "function", stateMutability: "nonpayable", inputs: [{ name: "message", type: "string" }], outputs: [] },
];

const memoAbi = [
  { name: "memo", type: "function", stateMutability: "nonpayable", inputs: [{ name: "target", type: "address" }, { name: "data", type: "bytes" }, { name: "memoId", type: "bytes32" }, { name: "memoData", type: "bytes" }], outputs: [{ type: "bytes" }] },
];

async function main() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║   Arc Agent Economy v2 — Full Integration            ║");
  console.log("║   ERC-8004 + SpendingLimits + SplitPayment + Memo   ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  const account = privateKeyToAccount(`0x${process.env.PRIVATE_KEY}`);
  const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
  const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http() });

  const AGENT_WALLET = account.address;
  const TREASURY = "0x54b4B44749a95070560509B6Ec0be501665CcF63";

  console.log(`Controller/Owner: ${AGENT_WALLET}\n`);

  // Step 1: Setup SpendingLimits for Agent
  console.log("📊 Step 1: Setup SpendingLimits for Agent...");
  try {
    const hash = await walletClient.writeContract({
      address: SPENDING_LIMITS,
      abi: spendingLimitsAbi,
      functionName: "setLimit",
      args: [
        AGENT_WALLET,
        1000000000000000000n, // 1 USDC daily
        5000000000000000000n, // 5 USDC weekly
        100000000000000000n,  // 0.1 USDC per tx
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ SpendingLimits set | TX: ${hash}`);
  } catch(e) {
    console.log("setLimit error:", e.message.slice(0, 100));
  }

  // Step 2: Check canSpend
  console.log("\n📊 Step 2: canSpend check...");
  try {
    const [canSpend, reason] = await publicClient.readContract({
      address: SPENDING_LIMITS,
      abi: spendingLimitsAbi,
      functionName: "canSpend",
      args: [AGENT_WALLET, 10000000000000000n], // 0.01 USDC
    });
    console.log(`✅ canSpend: ${canSpend} | reason: ${reason}`);
  } catch(e) {
    console.log("canSpend error:", e.message.slice(0, 100));
  }

  // Step 3: Setup SplitPayment
  console.log("\n📊 Step 3: Create SplitPayment config...");
  let splitId = 0n;
  try {
    const hash = await walletClient.writeContract({
      address: SPLIT_PAYMENT,
      abi: splitPaymentAbi,
      functionName: "createSplit",
      args: [
        "Agent Mission Revenue",
        [AGENT_WALLET, TREASURY],
        [7000n, 3000n],
        ["agent-a", "treasury"],
      ],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ SplitPayment created | TX: ${hash}`);
  } catch(e) {
    console.log("createSplit error:", e.message.slice(0, 100));
  }

  // Step 4: RecordMission with Memo
  console.log("\n📊 Step 4: RecordMission + Memo...");
  try {
    const missionData = encodeFunctionData({
      abi: agentIdentityAbi,
      functionName: "recordMission",
      args: [1n, true],
    });

    const memoId = "0x" + Buffer.from("arc-mission-001").toString("hex").padEnd(64, "0");
    const memoData = `0x${Buffer.from(JSON.stringify({ agentId: 1, mission: "api-purchase", amount: "0.01", timestamp: Date.now() })).toString("hex")}`;

    const hash = await walletClient.writeContract({
      address: MEMO_PRECOMPILE,
      abi: memoAbi,
      functionName: "memo",
      args: [AGENT_IDENTITY, missionData, memoId, memoData],
      gas: 500000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ Mission recorded with Memo | TX: ${hash} | Status: ${receipt.status}`);
  } catch(e) {
    console.log("recordMission+Memo error:", e.message.slice(0, 100));
  }

  // Step 5: RecordSpend
  console.log("\n📊 Step 5: RecordSpend...");
  try {
    const hash = await walletClient.writeContract({
      address: SPENDING_LIMITS,
      abi: spendingLimitsAbi,
      functionName: "recordSpend",
      args: [AGENT_WALLET, 10000000000000000n],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ Spend recorded | TX: ${hash}`);

    const remaining = await publicClient.readContract({
      address: SPENDING_LIMITS,
      abi: spendingLimitsAbi,
      functionName: "remainingDaily",
      args: [AGENT_WALLET],
    });
    console.log(`✅ Remaining daily: ${Number(remaining) / 1e18} USDC`);
  } catch(e) {
    console.log("recordSpend error:", e.message.slice(0, 100));
  }

  // Step 6: Log everything on-chain via EventLogger + Memo
  console.log("\n📊 Step 6: On-chain audit log with Memo...");
  try {
    const logData = encodeFunctionData({
      abi: eventLoggerAbi,
      functionName: "logMessage",
      args: [`Arc Agent Economy v2: mission=api-purchase, agent=arc-agent-a, amount=0.01 USDC, split=70/30`],
    });

    const memoId = "0x" + Buffer.from("arc-audit-001").toString("hex").padEnd(64, "0");
    const memoData = `0x${Buffer.from("type=audit,sprint=6,status=success").toString("hex")}`;

    const hash = await walletClient.writeContract({
      address: MEMO_PRECOMPILE,
      abi: memoAbi,
      functionName: "memo",
      args: [EVENT_LOGGER, logData, memoId, memoData],
      gas: 500000n,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ Audit log on-chain | TX: ${hash} | Status: ${receipt.status}`);
  } catch(e) {
    console.log("audit log error:", e.message.slice(0, 100));
  }

  // Step 7: getSuccessRate
  console.log("\n📊 Step 7: Agent success rate...");
  try {
    const rate = await publicClient.readContract({
      address: AGENT_IDENTITY,
      abi: agentIdentityAbi,
      functionName: "getSuccessRate",
      args: [1n],
    });
    console.log(`✅ Agent A success rate: ${rate}%`);
  } catch(e) {
    console.log("getSuccessRate error:", e.message.slice(0, 100));
  }

  console.log("\n╔══════════════════════════════════════════════════════╗");
  console.log("║   Arc Agent Economy v2 — Complete!                  ║");
  console.log("╚══════════════════════════════════════════════════════╝");
}

main().catch(console.error);
