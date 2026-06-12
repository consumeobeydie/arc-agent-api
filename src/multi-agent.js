const { initiateDeveloperControlledWalletsClient } = require("@circle-fin/developer-controlled-wallets");
const { createPublicClient, createWalletClient, http, keccak256, toHex, decodeEventLog, formatUnits } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const dotenv = require("dotenv");

dotenv.config();

const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
  testnet: true,
};

const ORCHESTRATOR_CONTRACT = "0xe81f5BA4181eA29061C3C229c8D6EB4cFE56639C";
const MISSION_BUDGET = BigInt("500000000000000000");
const SUB_BUDGET = BigInt("150000000000000000");

const orchestratorAbi = [
  { name: "registerAgent", type: "function", stateMutability: "nonpayable", inputs: [{ name: "wallet", type: "address" }, { name: "name", type: "string" }, { name: "capability", type: "string" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "createMission", type: "function", stateMutability: "payable", inputs: [{ name: "description", type: "string" }, { name: "requirement", type: "string" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "assignMission", type: "function", stateMutability: "nonpayable", inputs: [{ name: "missionId", type: "uint256" }, { name: "agentId", type: "uint256" }], outputs: [] },
  { name: "hireSubAgent", type: "function", stateMutability: "nonpayable", inputs: [{ name: "missionId", type: "uint256" }, { name: "subAgentId", type: "uint256" }, { name: "subBudget", type: "uint256" }], outputs: [] },
  { name: "completeMission", type: "function", stateMutability: "nonpayable", inputs: [{ name: "missionId", type: "uint256" }, { name: "deliverable", type: "bytes32" }], outputs: [] },
  { name: "getAgent", type: "function", stateMutability: "view", inputs: [{ name: "agentId", type: "uint256" }], outputs: [{ name: "", type: "uint256" }, { name: "", type: "address" }, { name: "", type: "string" }, { name: "", type: "string" }, { name: "", type: "uint256" }, { name: "", type: "uint256" }, { name: "", type: "uint8" }] },
  { name: "getMission", type: "function", stateMutability: "view", inputs: [{ name: "missionId", type: "uint256" }], outputs: [{ name: "", type: "uint256" }, { name: "", type: "address" }, { name: "", type: "string" }, { name: "", type: "uint256" }, { name: "", type: "uint256" }, { name: "", type: "uint8" }, { name: "", type: "bytes32" }] },
  { name: "agentCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "missionCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
  { name: "agentIdByAddress", type: "function", stateMutability: "view", inputs: [{ name: "wallet", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "MissionCreated", type: "event", inputs: [{ indexed: true, name: "missionId", type: "uint256" }, { indexed: true, name: "creator", type: "address" }, { indexed: false, name: "budget", type: "uint256" }] },
  { name: "MissionCompleted", type: "event", inputs: [{ indexed: true, name: "missionId", type: "uint256" }, { indexed: true, name: "agentId", type: "uint256" }, { indexed: false, name: "deliverable", type: "bytes32" }] },
];

const mainAccount = privateKeyToAccount(`0x${process.env.SELLER_PRIVATE_KEY}`);

const circleClient = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET,
});

const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
const mainWalletClient = createWalletClient({ account: mainAccount, chain: arcTestnet, transport: http() });

async function waitForCircleTx(txId, label) {
  process.stdout.write("  Waiting for " + label);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { data } = await circleClient.getTransaction({ id: txId });
    if (data?.transaction?.state === "COMPLETE") {
      console.log(" OK\n  Tx: https://testnet.arcscan.app/tx/" + data.transaction.txHash);
      return data.transaction.txHash;
    }
    if (data?.transaction?.state === "FAILED") throw new Error(label + " failed");
    process.stdout.write(".");
  }
  throw new Error(label + " timed out");
}

async function main() {
  console.log("\n=== Arc Multi-Agent System ===");
  console.log("Orchestrator: " + ORCHESTRATOR_CONTRACT);
  console.log("Main Account: " + mainAccount.address);
  console.log("==============================\n");

  // Step 1: Check existing state
  console.log("STEP 1: Check existing state");
  const [agentCount, missionCount] = await Promise.all([
    publicClient.readContract({ address: ORCHESTRATOR_CONTRACT, abi: orchestratorAbi, functionName: "agentCount" }),
    publicClient.readContract({ address: ORCHESTRATOR_CONTRACT, abi: orchestratorAbi, functionName: "missionCount" }),
  ]);
  console.log("  Existing agents: " + agentCount);
  console.log("  Existing missions: " + missionCount);

  // Step 2: Get existing agents info
  console.log("\nSTEP 2: Get existing agents");
  const agentA = await publicClient.readContract({ address: ORCHESTRATOR_CONTRACT, abi: orchestratorAbi, functionName: "getAgent", args: [BigInt(0)] });
  const agentB = await publicClient.readContract({ address: ORCHESTRATOR_CONTRACT, abi: orchestratorAbi, functionName: "getAgent", args: [BigInt(1)] });
  console.log("  Agent A: " + agentA[1] + " (" + agentA[2] + ")");
  console.log("  Agent B: " + agentB[1] + " (" + agentB[2] + ")");

  // Step 3: Create new mission
  console.log("\nSTEP 3: Create new mission");
  const createMissionTx = await mainWalletClient.writeContract({
    address: ORCHESTRATOR_CONTRACT,
    abi: orchestratorAbi,
    functionName: "createMission",
    args: ["Arc Intelligence Multi-Agent Mission #2", "orchestration,execution,data_processing"],
    value: MISSION_BUDGET,
    account: mainAccount,
  });
  const missionReceipt = await publicClient.waitForTransactionReceipt({ hash: createMissionTx });
  console.log("  Mission created: https://testnet.arcscan.app/tx/" + createMissionTx);

  let missionId = missionCount;
  for (const log of missionReceipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: orchestratorAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "MissionCreated") { missionId = decoded.args.missionId; break; }
    } catch { continue; }
  }
  console.log("  Mission ID: " + missionId);

  // Step 4: Assign mission to Agent A
  console.log("\nSTEP 4: Assign mission to Agent A");
  const assignTx = await mainWalletClient.writeContract({
    address: ORCHESTRATOR_CONTRACT,
    abi: orchestratorAbi,
    functionName: "assignMission",
    args: [missionId, BigInt(0)],
    account: mainAccount,
  });
  await publicClient.waitForTransactionReceipt({ hash: assignTx });
  console.log("  Mission assigned: https://testnet.arcscan.app/tx/" + assignTx);

  // Step 5: Fund Agent B for gas
  console.log("\nSTEP 5: Fund Agent B for gas");
  const fundBTx = await circleClient.createTransaction({
    walletAddress: process.env.CIRCLE_WALLET_ADDRESS,
    blockchain: "ARC-TESTNET",
    tokenAddress: "0x3600000000000000000000000000000000000000",
    destinationAddress: agentB[1],
    amount: ["1"],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  await waitForCircleTx(fundBTx.data?.id, "fund Agent B");

  // Step 6: Agent A hires Agent B
  console.log("\nSTEP 6: Agent A hires Agent B (autonomous)");
  const hireTx = await mainWalletClient.writeContract({
    address: ORCHESTRATOR_CONTRACT,
    abi: orchestratorAbi,
    functionName: "hireSubAgent",
    args: [missionId, BigInt(1), SUB_BUDGET],
    account: mainAccount,
  });
  await publicClient.waitForTransactionReceipt({ hash: hireTx });
  console.log("  Agent B hired: https://testnet.arcscan.app/tx/" + hireTx);

  // Step 7: Agent B completes mission
  console.log("\nSTEP 7: Agent B completes mission");
  const deliverable = keccak256(toHex("arc-multi-agent-mission-2-deliverable"));
  const completeTx = await circleClient.createContractExecutionTransaction({
    walletAddress: agentB[1],
    blockchain: "ARC-TESTNET",
    contractAddress: ORCHESTRATOR_CONTRACT,
    abiFunctionSignature: "completeMission(uint256,bytes32)",
    abiParameters: [missionId.toString(), deliverable],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  await waitForCircleTx(completeTx.data?.id, "complete mission");

  // Step 8: Final state
  console.log("\nSTEP 8: Final state");
  const mission = await publicClient.readContract({
    address: ORCHESTRATOR_CONTRACT,
    abi: orchestratorAbi,
    functionName: "getMission",
    args: [missionId],
  });

  const updatedAgentA = await publicClient.readContract({ address: ORCHESTRATOR_CONTRACT, abi: orchestratorAbi, functionName: "getAgent", args: [BigInt(0)] });
  const updatedAgentB = await publicClient.readContract({ address: ORCHESTRATOR_CONTRACT, abi: orchestratorAbi, functionName: "getAgent", args: [BigInt(1)] });

  const STATUS = ["Open", "Assigned", "InProgress", "Completed", "Failed"];

  console.log("\n=== Multi-Agent Flow Complete ===");
  console.log("Mission ID:     " + mission[0]);
  console.log("Mission Status: " + STATUS[Number(mission[5])]);
  console.log("Total Budget:   " + formatUnits(mission[3], 18) + " ETH");
  console.log("Sub Budget:     " + formatUnits(mission[4], 18) + " ETH");
  console.log("\nAgent A (Orchestrator):");
  console.log("  Address:    " + updatedAgentA[1]);
  console.log("  Reputation: " + updatedAgentA[4]);
  console.log("  Missions:   " + updatedAgentA[5]);
  console.log("\nAgent B (Worker):");
  console.log("  Address:    " + updatedAgentB[1]);
  console.log("  Reputation: " + updatedAgentB[4]);
  console.log("  Missions:   " + updatedAgentB[5]);
  console.log("\nExplorer: https://testnet.arcscan.app/address/" + ORCHESTRATOR_CONTRACT);
}

main().catch(console.error);
