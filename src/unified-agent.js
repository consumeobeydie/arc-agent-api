const { initiateDeveloperControlledWalletsClient } = require("@circle-fin/developer-controlled-wallets");
const { createPublicClient, createWalletClient, http, parseAbiItem, keccak256, toHex, decodeEventLog, formatUnits, parseUnits } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { wrapFetchWithPayment } = require("x402-fetch");
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

const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
const REPUTATION_REGISTRY = "0x8004B663056A597Dffe9eCcC1965A193B7388713";
const VALIDATION_REGISTRY = "0x8004Cb1BF31DAf7788923b405b754f57acEB4272";
const AGENTIC_COMMERCE_CONTRACT = "0x0747EEf0706327138c69792bF28Cd525089e4583";
const USDC_CONTRACT = "0x3600000000000000000000000000000000000000";
const API_BASE_URL = "http://localhost:3000";
const JOB_BUDGET = parseUnits("1", 6);
const STATUS_NAMES = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Expired"];

const agenticCommerceAbi = [
  { name: "createJob", type: "function", stateMutability: "nonpayable", inputs: [{ name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "expiredAt", type: "uint256" }, { name: "description", type: "string" }, { name: "hook", type: "address" }], outputs: [{ name: "jobId", type: "uint256" }] },
  { name: "setBudget", type: "function", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "amount", type: "uint256" }, { name: "optParams", type: "bytes" }], outputs: [] },
  { name: "fund", type: "function", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "optParams", type: "bytes" }], outputs: [] },
  { name: "submit", type: "function", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "deliverable", type: "bytes32" }, { name: "optParams", type: "bytes" }], outputs: [] },
  { name: "complete", type: "function", stateMutability: "nonpayable", inputs: [{ name: "jobId", type: "uint256" }, { name: "reason", type: "bytes32" }, { name: "optParams", type: "bytes" }], outputs: [] },
  { name: "getJob", type: "function", stateMutability: "view", inputs: [{ name: "jobId", type: "uint256" }], outputs: [{ type: "tuple", components: [{ name: "id", type: "uint256" }, { name: "client", type: "address" }, { name: "provider", type: "address" }, { name: "evaluator", type: "address" }, { name: "description", type: "string" }, { name: "budget", type: "uint256" }, { name: "expiredAt", type: "uint256" }, { name: "status", type: "uint8" }, { name: "hook", type: "address" }] }] },
  { name: "JobCreated", type: "event", anonymous: false, inputs: [{ indexed: true, name: "jobId", type: "uint256" }, { indexed: true, name: "client", type: "address" }, { indexed: true, name: "provider", type: "address" }, { indexed: false, name: "evaluator", type: "address" }, { indexed: false, name: "expiredAt", type: "uint256" }, { indexed: false, name: "hook", type: "address" }] },
];

// Main account - 0x54b4B44749a95070560509B6Ec0be501665CcF63
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
  console.log("\n=== Arc Unified Agentic Flow ===");
  console.log("Main Agent: " + mainAccount.address);
  console.log("================================\n");

  // ── PHASE 1: X402 Payment ──
  console.log("PHASE 1: X402 Payment");
  console.log("---------------------");

  const { default: nodeFetch } = await import("node-fetch");
  const fetchWithPayment = wrapFetchWithPayment(nodeFetch, mainWalletClient);

  const infoRes = await nodeFetch(`${API_BASE_URL}/api/info`);
  const info = await infoRes.json();
  console.log("  API: " + info.name);

  const dataRes = await fetchWithPayment(`${API_BASE_URL}/api/arc-data`);
  const arcData = await dataRes.json();
  console.log("  X402 payment: OK");
  console.log("  Arc data received: " + arcData.data.network + " (Chain ID: " + arcData.data.chainId + ")");

  // ── PHASE 2: ERC-8004 Identity ──
  console.log("\nPHASE 2: ERC-8004 Agent Identity");
  console.log("---------------------------------");

  // Create validator wallet (Circle managed - only for validator role)
  const validatorWalletSet = await circleClient.createWalletSet({ name: "Arc Agent Validator" });
  const validatorResponse = await circleClient.createWallets({
    blockchains: ["ARC-TESTNET"],
    count: 1,
    walletSetId: validatorWalletSet.data?.walletSet?.id,
    accountType: "SCA",
  });
  const validatorWallet = validatorResponse.data?.wallets?.[0];
  console.log("  Validator wallet: " + validatorWallet.address);

  // Register identity using main account
  const registerTx = await mainWalletClient.writeContract({
    address: IDENTITY_REGISTRY,
    abi: [{ name: "register", type: "function", stateMutability: "nonpayable", inputs: [{ name: "metadataURI", type: "string" }], outputs: [] }],
    functionName: "register",
    args: ["ipfs://bafkreibdi6623n3xpf7ymk62ckb4bo75o3qemwkpfvp5i25j66itxvsoei"],
    account: mainAccount,
  });

  const registerReceipt = await publicClient.waitForTransactionReceipt({ hash: registerTx });
  console.log("  Identity registered: https://testnet.arcscan.app/tx/" + registerTx);

  // Get agent ID
  const latestBlock = await publicClient.getBlockNumber();
  const fromBlock = latestBlock > 10000n ? latestBlock - 10000n : 0n;
  const transferLogs = await publicClient.getLogs({
    address: IDENTITY_REGISTRY,
    event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"),
    args: { to: mainAccount.address },
    fromBlock,
    toBlock: latestBlock,
  });

  const agentId = transferLogs[transferLogs.length - 1].args.tokenId;
  console.log("  Agent ID: " + agentId);

  // Record reputation using validator
  const tag = "x402_payment_verified";
  const feedbackHash = keccak256(toHex(tag));
  const reputationTx = await circleClient.createContractExecutionTransaction({
    walletAddress: validatorWallet.address,
    blockchain: "ARC-TESTNET",
    contractAddress: REPUTATION_REGISTRY,
    abiFunctionSignature: "giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)",
    abiParameters: [agentId.toString(), "95", "0", tag, "", "", "", feedbackHash],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  await waitForCircleTx(reputationTx.data?.id, "reputation");

  // ── PHASE 3: ERC-8183 Job ──
  console.log("\nPHASE 3: ERC-8183 Job Lifecycle");
  console.log("--------------------------------");

  // Create provider wallet (Circle managed - only for provider role)
  const providerWalletSet = await circleClient.createWalletSet({ name: "Arc Job Provider" });
  const providerResponse = await circleClient.createWallets({
    blockchains: ["ARC-TESTNET"],
    count: 1,
    walletSetId: providerWalletSet.data?.walletSet?.id,
    accountType: "SCA",
  });
  const providerWallet = providerResponse.data?.wallets?.[0];
  console.log("  Provider wallet: " + providerWallet.address);

  // Transfer starter USDC to provider
  const transferTx = await circleClient.createTransaction({
    walletAddress: process.env.CIRCLE_WALLET_ADDRESS,
    blockchain: "ARC-TESTNET",
    tokenAddress: USDC_CONTRACT,
    destinationAddress: providerWallet.address,
    amount: ["1"],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  await waitForCircleTx(transferTx.data?.id, "USDC transfer to provider");

  // Create job - main account as client
  const now = await publicClient.getBlock();
  const expiredAt = now.timestamp + 3600n;

  const createJobHash = await mainWalletClient.writeContract({
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: agenticCommerceAbi,
    functionName: "createJob",
    args: [providerWallet.address, mainAccount.address, expiredAt, "Arc Intelligence API - Unified Agentic Flow", "0x0000000000000000000000000000000000000000"],
    account: mainAccount,
  });

  const createJobReceipt = await publicClient.waitForTransactionReceipt({ hash: createJobHash });
  console.log("  createJob: https://testnet.arcscan.app/tx/" + createJobHash);

  let jobId;
  for (const log of createJobReceipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: agenticCommerceAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "JobCreated") { jobId = decoded.args.jobId; break; }
    } catch { continue; }
  }
  console.log("  Job ID: " + jobId);

  // Set budget (provider)
  const setBudgetTx = await circleClient.createContractExecutionTransaction({
    walletAddress: providerWallet.address,
    blockchain: "ARC-TESTNET",
    contractAddress: AGENTIC_COMMERCE_CONTRACT,
    abiFunctionSignature: "setBudget(uint256,uint256,bytes)",
    abiParameters: [jobId.toString(), JOB_BUDGET.toString(), "0x"],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  await waitForCircleTx(setBudgetTx.data?.id, "setBudget");

  // Approve USDC (main account)
  const approveHash = await mainWalletClient.writeContract({
    address: USDC_CONTRACT,
    abi: [{ name: "approve", type: "function", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] }],
    functionName: "approve",
    args: [AGENTIC_COMMERCE_CONTRACT, JOB_BUDGET],
    account: mainAccount,
  });
  await publicClient.waitForTransactionReceipt({ hash: approveHash });
  console.log("  approve: https://testnet.arcscan.app/tx/" + approveHash);

  // Fund escrow (main account)
  const fundHash = await mainWalletClient.writeContract({
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: agenticCommerceAbi,
    functionName: "fund",
    args: [jobId, "0x"],
    account: mainAccount,
  });
  await publicClient.waitForTransactionReceipt({ hash: fundHash });
  console.log("  fund: https://testnet.arcscan.app/tx/" + fundHash);

  // Submit deliverable (provider)
  const deliverableHash = keccak256(toHex("arc-intelligence-unified-agent-deliverable"));
  const submitTx = await circleClient.createContractExecutionTransaction({
    walletAddress: providerWallet.address,
    blockchain: "ARC-TESTNET",
    contractAddress: AGENTIC_COMMERCE_CONTRACT,
    abiFunctionSignature: "submit(uint256,bytes32,bytes)",
    abiParameters: [jobId.toString(), deliverableHash, "0x"],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  await waitForCircleTx(submitTx.data?.id, "submit");

  // Complete job (main account as evaluator)
  const reasonHash = keccak256(toHex("arc-intelligence-job-approved"));
  const completeHash = await mainWalletClient.writeContract({
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: agenticCommerceAbi,
    functionName: "complete",
    args: [jobId, reasonHash, "0x"],
    account: mainAccount,
  });
  await publicClient.waitForTransactionReceipt({ hash: completeHash });
  console.log("  complete: https://testnet.arcscan.app/tx/" + completeHash);

  // Final state
  const job = await publicClient.readContract({
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: agenticCommerceAbi,
    functionName: "getJob",
    args: [jobId],
  });

  console.log("\n=== Unified Agentic Flow Complete ===");
  console.log("Main Agent: " + mainAccount.address);
  console.log("Agent ID:   " + agentId);
  console.log("Job ID:     " + jobId);
  console.log("Job Status: " + STATUS_NAMES[Number(job.status)]);
  console.log("Budget:     " + formatUnits(job.budget, 6) + " USDC");
  console.log("\nPhases completed:");
  console.log("  PHASE 1: X402 payment - OK");
  console.log("  PHASE 2: ERC-8004 identity registered - OK");
  console.log("  PHASE 3: ERC-8183 job completed - OK");
  console.log("\nExplorer: https://testnet.arcscan.app/address/" + mainAccount.address);
}

main().catch(console.error);
