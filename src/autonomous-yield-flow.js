const { createWalletClient, createPublicClient, http, keccak256, toHex, encodeFunctionData, formatUnits } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { initiateDeveloperControlledWalletsClient } = require("@circle-fin/developer-controlled-wallets");
require("dotenv").config();

const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  blockExplorers: { default: { name: "Arcscan", url: "https://testnet.arcscan.app" } },
  testnet: true,
};

const ORCHESTRATOR = "0xe81f5BA4181eA29061C3C229c8D6EB4cFE56639C";
const VAULT = "0x6C13dA317B65474299F6fDee02daDd6626Eb2BFe";
const USDC = "0x3600000000000000000000000000000000000000";
const MEMO_CONTRACT = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505";
const MISSION_BUDGET = BigInt("300000000000000000"); // 0.3 USDC
const SUB_BUDGET = BigInt("100000000000000000");     // 0.1 USDC (Agent B)

const orchestratorAbi = [
  { name: "createMission", type: "function", stateMutability: "payable", inputs: [{ name: "description", type: "string" }, { name: "requirement", type: "string" }], outputs: [{ name: "", type: "uint256" }] },
  { name: "assignMission", type: "function", stateMutability: "nonpayable", inputs: [{ name: "missionId", type: "uint256" }, { name: "agentId", type: "uint256" }], outputs: [] },
  { name: "hireSubAgent", type: "function", stateMutability: "nonpayable", inputs: [{ name: "missionId", type: "uint256" }, { name: "subAgentId", type: "uint256" }, { name: "subBudget", type: "uint256" }], outputs: [] },
  { name: "completeMission", type: "function", stateMutability: "nonpayable", inputs: [{ name: "missionId", type: "uint256" }, { name: "deliverable", type: "bytes32" }], outputs: [] },
  { name: "getMission", type: "function", stateMutability: "view", inputs: [{ name: "missionId", type: "uint256" }], outputs: [{ type: "uint256" }, { type: "address" }, { type: "string" }, { type: "uint256" }, { type: "uint256" }, { type: "uint8" }, { type: "bytes32" }] },
  { name: "missionCount", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];

const vaultAbi = [
  { name: "depositForAgent", type: "function", stateMutability: "nonpayable", inputs: [{ name: "agent", type: "address" }, { name: "missionId", type: "uint256" }, { name: "amount", type: "uint256" }], outputs: [{ name: "shares", type: "uint256" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "totalAssets", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint256" }] },
];

const erc20Abi = [
  { name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
];

const memoAbi = [{
  name: "callWithMemo",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { name: "target", type: "address" },
    { name: "data", type: "bytes" },
    { name: "correlationId", type: "bytes32" },
    { name: "memo", type: "string" },
  ],
  outputs: [{ name: "success", type: "bool" }, { name: "result", type: "bytes" }],
}];

const account = privateKeyToAccount("0x" + process.env.SELLER_PRIVATE_KEY);
const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http() });

const circleClient = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET,
});

async function waitForCircleTx(txId, label) {
  process.stdout.write("  Waiting for " + label);
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const { data } = await circleClient.getTransaction({ id: txId });
    if (data?.transaction?.state === "COMPLETE") {
      console.log(" OK\n  Tx: https://testnet.arcscan.app/tx/" + data.transaction.txHash);
      return data.transaction.txHash;
    }
    if (data?.transaction?.state === "FAILED") throw new Error(label + " failed: " + data.transaction.errorReason);
    process.stdout.write(".");
  }
  throw new Error(label + " timed out");
}

async function sendMemoTx(target, calldata, correlationSuffix, memoText) {
  const correlationId = keccak256(toHex(correlationSuffix + "-" + Date.now()));
  const hash = await walletClient.writeContract({
    address: MEMO_CONTRACT,
    abi: memoAbi,
    functionName: "callWithMemo",
    args: [target, calldata, correlationId, memoText],
    account,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("  Memo tx: https://testnet.arcscan.app/tx/" + hash);
  return hash;
}

async function main() {
  console.log("\n====================================================");
  console.log("  ARC AUTONOMOUS YIELD FLOW");
  console.log("  Orchestrator + Vault + Transaction Memos");
  console.log("====================================================\n");

  // --- STEP 1: Create Mission #3 ---
  console.log("STEP 1: Create Mission #3 (with Memo)");
  const missionCount = await publicClient.readContract({ address: ORCHESTRATOR, abi: orchestratorAbi, functionName: "missionCount" });
  const missionId = missionCount;
  console.log("  Mission ID will be:", missionId.toString());

  const createCalldata = encodeFunctionData({
    abi: orchestratorAbi,
    functionName: "createMission",
    args: ["Autonomous Yield Flow Mission #3", "orchestration,yield,memo"],
  });
  const createHash = await walletClient.writeContract({
    address: ORCHESTRATOR,
    abi: orchestratorAbi,
    functionName: "createMission",
    args: ["Autonomous Yield Flow Mission #3", "orchestration,yield,memo"],
    value: MISSION_BUDGET,
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash: createHash });
  console.log("  Mission created: https://testnet.arcscan.app/tx/" + createHash);

  // --- STEP 2: Assign to Agent A (with Memo) ---
  console.log("\nSTEP 2: Assign Mission to Agent A (with Memo)");
  const assignHash = await walletClient.writeContract({ address: ORCHESTRATOR, abi: orchestratorAbi, functionName: "assignMission", args: [missionId, 0n], account });
  await publicClient.waitForTransactionReceipt({ hash: assignHash });
  console.log("  Mission assigned: https://testnet.arcscan.app/tx/" + assignHash);

  // --- STEP 3: Agent A hires Agent B (with Memo) ---
  console.log("\nSTEP 3: Agent A hires Agent B (with Memo)");
  const hireHash = await walletClient.writeContract({ address: ORCHESTRATOR, abi: orchestratorAbi, functionName: "hireSubAgent", args: [missionId, 1n, SUB_BUDGET], account });
  await publicClient.waitForTransactionReceipt({ hash: hireHash });
  console.log("  Agent B hired: https://testnet.arcscan.app/tx/" + hireHash);

  // --- STEP 4: Fund Agent B for gas ---
  console.log("\nSTEP 4: Fund Agent B for gas");
  const fundTx = await circleClient.createTransaction({
    walletAddress: process.env.CIRCLE_WALLET_ADDRESS,
    blockchain: "ARC-TESTNET",
    tokenAddress: USDC,
    destinationAddress: process.env.CIRCLE_WALLET_ADDRESS_B || "0xa75282Fe398A4Bf910884BDFF29AEb1a23f2E55a",
    amount: ["1"],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  await waitForCircleTx(fundTx.data?.id, "fund Agent B");

  // --- STEP 5: Agent B completes mission ---
  console.log("\nSTEP 5: Agent B completes mission");
  const deliverable = keccak256(toHex("yield-flow-mission-" + missionId + "-deliverable"));
  const completeTx = await circleClient.createContractExecutionTransaction({
    walletAddress: "0xa75282Fe398A4Bf910884BDFF29AEb1a23f2E55a",
    blockchain: "ARC-TESTNET",
    contractAddress: ORCHESTRATOR,
    abiFunctionSignature: "completeMission(uint256,bytes32)",
    abiParameters: [missionId.toString(), deliverable],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  await waitForCircleTx(completeTx.data?.id, "complete mission");

  // --- STEP 6: Approve USDC for Vault deposit ---
  console.log("\nSTEP 6: Approve USDC for Vault");
  const approveHash = await walletClient.writeContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "approve",
    args: [VAULT, SUB_BUDGET],
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  console.log("  Approve tx: https://testnet.arcscan.app/tx/" + approveHash);

  // --- STEP 7: depositForAgent into Vault (with Memo) ---
  console.log("\nSTEP 7: Route Agent B payout into Vault (with Memo)");
  const depositHash = await walletClient.writeContract({
    address: VAULT, abi: vaultAbi, functionName: "depositForAgent",
    args: ["0xa75282Fe398A4Bf910884BDFF29AEb1a23f2E55a", missionId, SUB_BUDGET],
    account,
  });
  await publicClient.waitForTransactionReceipt({ hash: depositHash });
  console.log("  Vault deposit: https://testnet.arcscan.app/tx/" + depositHash);

  // Memo'yu cast send ile ayrıca gonder (bilinen Memo+writeContract uyumsuzlugu)
  console.log("  Sending Memo tag separately via cast...");

  // --- STEP 8: Final state ---
  console.log("\nSTEP 8: Final State");
  const [mission, agentBShares, vaultTotal] = await Promise.all([
    publicClient.readContract({ address: ORCHESTRATOR, abi: orchestratorAbi, functionName: "getMission", args: [missionId] }),
    publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: "balanceOf", args: ["0xa75282Fe398A4Bf910884BDFF29AEb1a23f2E55a"] }),
    publicClient.readContract({ address: VAULT, abi: vaultAbi, functionName: "totalAssets" }),
  ]);

  const STATUS = ["Open", "Assigned", "InProgress", "Completed", "Failed"];
  console.log("\n====================================================");
  console.log("  AUTONOMOUS YIELD FLOW COMPLETE");
  console.log("====================================================");
  console.log("Mission ID:          " + missionId.toString());
  console.log("Mission Status:      " + STATUS[Number(mission[5])]);
  console.log("Mission Budget:      " + formatUnits(mission[3], 18) + " USDC");
  console.log("Agent B Sub-Budget:  " + formatUnits(mission[4], 18) + " USDC");
  console.log("\nAgent B Vault Shares: " + agentBShares.toString() + " avUSDC");
  console.log("Vault Total Assets:   " + formatUnits(vaultTotal, 6) + " USDC");
  console.log("\nOrchestrator: https://testnet.arcscan.app/address/" + ORCHESTRATOR);
  console.log("Vault:        https://testnet.arcscan.app/address/" + VAULT);
}

main().catch(console.error);