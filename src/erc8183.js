const { initiateDeveloperControlledWalletsClient } = require("@circle-fin/developer-controlled-wallets");
const { createPublicClient, http, decodeEventLog, formatUnits, keccak256, parseUnits, toHex } = require("viem");
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

const AGENTIC_COMMERCE_CONTRACT = "0x0747EEf0706327138c69792bF28Cd525089e4583";
const USDC_CONTRACT = "0x3600000000000000000000000000000000000000";
const JOB_BUDGET = parseUnits("5", 6);

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

const circleClient = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET,
});

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(),
});

async function waitForTransaction(txId, label) {
  process.stdout.write("  Waiting for " + label);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { data } = await circleClient.getTransaction({ id: txId });
    if (data?.transaction?.state === "COMPLETE") {
      const txHash = data.transaction.txHash;
      console.log(" OK\n  Tx: https://testnet.arcscan.app/tx/" + txHash);
      return txHash;
    }
    if (data?.transaction?.state === "FAILED") throw new Error(label + " failed");
    process.stdout.write(".");
  }
  throw new Error(label + " timed out");
}

async function main() {
  console.log("\nArc ERC-8183 Job Lifecycle");
  console.log("===========================\n");

  console.log("Step 1: Create wallets");
  const walletSet = await circleClient.createWalletSet({ name: "ERC8183 Job Wallets" });
  const walletsResponse = await circleClient.createWallets({
    blockchains: ["ARC-TESTNET"],
    count: 2,
    walletSetId: walletSet.data?.walletSet?.id,
    accountType: "SCA",
  });

  const clientWallet = walletsResponse.data?.wallets?.[0];
  const providerWallet = walletsResponse.data?.wallets?.[1];

  console.log("  Client:   " + clientWallet.address);
  console.log("  Provider: " + providerWallet.address);
  console.log("  Evaluator: " + clientWallet.address + " (client also evaluates)");

  console.log("\nStep 2: Fund client wallet from faucet");
  console.log("  Go to: https://faucet.circle.com");
  console.log("  Network: Arc Testnet");
  console.log("  Address: " + clientWallet.address);
  console.log("\n  Press Ctrl+C to stop, then restart after funding.");

  await new Promise((r) => setTimeout(r, 60000));

  console.log("\nStep 3: Transfer starter USDC to provider");
  const transferTx = await circleClient.createTransaction({
    walletAddress: clientWallet.address,
    blockchain: "ARC-TESTNET",
    tokenAddress: USDC_CONTRACT,
    destinationAddress: providerWallet.address,
    amount: ["1"],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  await waitForTransaction(transferTx.data?.id, "transfer to provider");

  const now = await publicClient.getBlock();
  const expiredAt = now.timestamp + 3600n;

  console.log("\nStep 4: Create job - createJob()");
  const createJobTx = await circleClient.createContractExecutionTransaction({
    walletAddress: clientWallet.address,
    blockchain: "ARC-TESTNET",
    contractAddress: AGENTIC_COMMERCE_CONTRACT,
    abiFunctionSignature: "createJob(address,address,uint256,string,address)",
    abiParameters: [providerWallet.address, clientWallet.address, expiredAt.toString(), "Arc Intelligence API - ERC-8183 demo job", "0x0000000000000000000000000000000000000000"],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  const createJobHash = await waitForTransaction(createJobTx.data?.id, "create job");

  const receipt = await publicClient.getTransactionReceipt({ hash: createJobHash });
  let jobId;
  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: agenticCommerceAbi, data: log.data, topics: log.topics });
      if (decoded.eventName === "JobCreated") { jobId = decoded.args.jobId; break; }
    } catch { continue; }
  }
  if (!jobId) throw new Error("Could not parse JobCreated event");
  console.log("  Job ID: " + jobId);

  console.log("\nStep 5: Set budget - setBudget()");
  const setBudgetTx = await circleClient.createContractExecutionTransaction({
    walletAddress: providerWallet.address,
    blockchain: "ARC-TESTNET",
    contractAddress: AGENTIC_COMMERCE_CONTRACT,
    abiFunctionSignature: "setBudget(uint256,uint256,bytes)",
    abiParameters: [jobId.toString(), JOB_BUDGET.toString(), "0x"],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  await waitForTransaction(setBudgetTx.data?.id, "set budget");

  console.log("\nStep 6: Approve USDC - approve()");
  const approveTx = await circleClient.createContractExecutionTransaction({
    walletAddress: clientWallet.address,
    blockchain: "ARC-TESTNET",
    contractAddress: USDC_CONTRACT,
    abiFunctionSignature: "approve(address,uint256)",
    abiParameters: [AGENTIC_COMMERCE_CONTRACT, JOB_BUDGET.toString()],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  await waitForTransaction(approveTx.data?.id, "approve USDC");

  console.log("\nStep 7: Fund escrow - fund()");
  const fundTx = await circleClient.createContractExecutionTransaction({
    walletAddress: clientWallet.address,
    blockchain: "ARC-TESTNET",
    contractAddress: AGENTIC_COMMERCE_CONTRACT,
    abiFunctionSignature: "fund(uint256,bytes)",
    abiParameters: [jobId.toString(), "0x"],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  await waitForTransaction(fundTx.data?.id, "fund escrow");

  console.log("\nStep 8: Submit deliverable - submit()");
  const deliverableHash = keccak256(toHex("arc-intelligence-api-deliverable"));
  const submitTx = await circleClient.createContractExecutionTransaction({
    walletAddress: providerWallet.address,
    blockchain: "ARC-TESTNET",
    contractAddress: AGENTIC_COMMERCE_CONTRACT,
    abiFunctionSignature: "submit(uint256,bytes32,bytes)",
    abiParameters: [jobId.toString(), deliverableHash, "0x"],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  await waitForTransaction(submitTx.data?.id, "submit deliverable");

  console.log("\nStep 9: Complete job - complete()");
  const reasonHash = keccak256(toHex("deliverable-approved"));
  const completeTx = await circleClient.createContractExecutionTransaction({
    walletAddress: clientWallet.address,
    blockchain: "ARC-TESTNET",
    contractAddress: AGENTIC_COMMERCE_CONTRACT,
    abiFunctionSignature: "complete(uint256,bytes32,bytes)",
    abiParameters: [jobId.toString(), reasonHash, "0x"],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });
  await waitForTransaction(completeTx.data?.id, "complete job");

  console.log("\nStep 10: Check final job state");
  const job = await publicClient.readContract({
    address: AGENTIC_COMMERCE_CONTRACT,
    abi: agenticCommerceAbi,
    functionName: "getJob",
    args: [jobId],
  });

  console.log("  Job ID:   " + job.id);
  console.log("  Status:   " + STATUS_NAMES[Number(job.status)]);
  console.log("  Budget:   " + formatUnits(job.budget, 6) + " USDC");
  console.log("  Client:   " + job.client);
  console.log("  Provider: " + job.provider);

  console.log("\nERC-8183 Job lifecycle complete!");
  console.log("  createJob -> setBudget -> fund -> submit -> complete");
  console.log("  Explorer: https://testnet.arcscan.app/address/" + clientWallet.address);
}

main().catch(console.error);
