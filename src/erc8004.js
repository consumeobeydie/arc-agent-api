const { initiateDeveloperControlledWalletsClient } = require("@circle-fin/developer-controlled-wallets");
const { createPublicClient, http, parseAbiItem, keccak256, toHex } = require("viem");
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
const METADATA_URI = "ipfs://bafkreibdi6623n3xpf7ymk62ckb4bo75o3qemwkpfvp5i25j66itxvsoei";

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
  for (let i = 0; i < 30; i++) {
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
  console.log("\n Arc ERC-8004 Agent Registration");
  console.log("===================================\n");

  console.log("Step 1: Create wallets");
  const walletSet = await circleClient.createWalletSet({ name: "Arc Intelligence Agent Wallets" });
  const walletsResponse = await circleClient.createWallets({
    blockchains: ["ARC-TESTNET"],
    count: 2,
    walletSetId: walletSet.data?.walletSet?.id,
    accountType: "SCA",
  });

  const ownerWallet = walletsResponse.data?.wallets?.[0];
  const validatorWallet = walletsResponse.data?.wallets?.[1];

  console.log("  Owner:     " + ownerWallet.address);
  console.log("  Validator: " + validatorWallet.address);

  console.log("\nStep 2: Register agent identity");
  const registerTx = await circleClient.createContractExecutionTransaction({
    walletAddress: ownerWallet.address,
    blockchain: "ARC-TESTNET",
    contractAddress: IDENTITY_REGISTRY,
    abiFunctionSignature: "register(string)",
    abiParameters: [METADATA_URI],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });

  await waitForTransaction(registerTx.data?.id, "registration");

  console.log("\nStep 3: Retrieve agent ID");
  const latestBlock = await publicClient.getBlockNumber();
  const fromBlock = latestBlock > 10000n ? latestBlock - 10000n : 0n;

  const transferLogs = await publicClient.getLogs({
    address: IDENTITY_REGISTRY,
    event: parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"),
    args: { to: ownerWallet.address },
    fromBlock,
    toBlock: latestBlock,
  });

  if (transferLogs.length === 0) throw new Error("No Transfer events found");

  const agentId = transferLogs[transferLogs.length - 1].args.tokenId.toString();
  console.log("  Agent ID: " + agentId);

  console.log("\nStep 4: Record reputation");
  const tag = "x402_payment_successful";
  const feedbackHash = keccak256(toHex(tag));

  const reputationTx = await circleClient.createContractExecutionTransaction({
    walletAddress: validatorWallet.address,
    blockchain: "ARC-TESTNET",
    contractAddress: REPUTATION_REGISTRY,
    abiFunctionSignature: "giveFeedback(uint256,int128,uint8,string,string,string,string,bytes32)",
    abiParameters: [agentId, "95", "0", tag, "", "", "", feedbackHash],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });

  await waitForTransaction(reputationTx.data?.id, "reputation");

  console.log("\nStep 5: Request validation");
  const requestHash = keccak256(toHex("arc_intelligence_agent_validation_" + agentId));

  const validationReqTx = await circleClient.createContractExecutionTransaction({
    walletAddress: ownerWallet.address,
    blockchain: "ARC-TESTNET",
    contractAddress: VALIDATION_REGISTRY,
    abiFunctionSignature: "validationRequest(address,uint256,string,bytes32)",
    abiParameters: [validatorWallet.address, agentId, "ipfs://bafkreiexamplevalidationrequest", requestHash],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });

  await waitForTransaction(validationReqTx.data?.id, "validation request");

  console.log("\nStep 6: Validation response");
  const validationResTx = await circleClient.createContractExecutionTransaction({
    walletAddress: validatorWallet.address,
    blockchain: "ARC-TESTNET",
    contractAddress: VALIDATION_REGISTRY,
    abiFunctionSignature: "validationResponse(bytes32,uint8,string,bytes32,string)",
    abiParameters: [requestHash, "100", "", "0x" + "0".repeat(64), "x402_agent_verified"],
    fee: { type: "level", config: { feeLevel: "MEDIUM" } },
  });

  await waitForTransaction(validationResTx.data?.id, "validation response");

  console.log("\nComplete!");
  console.log("  Identity registered on Arc Testnet");
  console.log("  Reputation recorded (score: 95)");
  console.log("  Validation verified (x402_agent_verified)");
  console.log("  Explorer: https://testnet.arcscan.app/address/" + ownerWallet.address);
}

main().catch(console.error);
