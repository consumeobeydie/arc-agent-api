const { createWalletClient, http } = require("viem");
const { baseSepolia } = require("viem/chains");
const { privateKeyToAccount } = require("viem/accounts");
const { wrapFetchWithPayment } = require("x402-fetch");
const dotenv = require("dotenv");

dotenv.config();

const API_BASE_URL = "http://localhost:3000";

async function runAgent() {
  console.log("🤖 Arc Intelligence Agent starting...");
  console.log("💳 Payment network: Base Sepolia");
  console.log("🌐 Data network: Arc Testnet (Chain ID: 5042002)");

  const privateKey = process.env.SELLER_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("SELLER_PRIVATE_KEY not found in .env");
  }

  const account = privateKeyToAccount(`0x${privateKey}`);
  console.log(`💳 Agent wallet: ${account.address}`);

  const walletClient = createWalletClient({
    account,
    chain: baseSepolia,
    transport: http(),
  });

  const { default: nodeFetch } = await import("node-fetch");
  const fetchWithPayment = wrapFetchWithPayment(nodeFetch, walletClient);

  console.log("\n📡 Step 1: Checking free endpoint...");
  const infoResponse = await nodeFetch(`${API_BASE_URL}/api/info`);
  const info = await infoResponse.json();
  console.log("✅ API Info:", info.name, "-", info.description);

  console.log("\n💰 Step 2: Requesting paid endpoint (with X402 payment)...");
  console.log("   Endpoint: /api/arc-data");
  console.log("   Price: $0.001 USDC");

  try {
    const dataResponse = await fetchWithPayment(`${API_BASE_URL}/api/arc-data`);

    if (dataResponse.status === 402) {
      console.log("⚠️  402 received - payment failed");
      const errorBody = await dataResponse.json();
      console.log("Error:", errorBody.error);
      return;
    }

    const data = await dataResponse.json();
    console.log("\n✅ Payment successful! Data received:");
    console.log("   Network:", data.data.network);
    console.log("   Chain ID:", data.data.chainId);
    console.log("   Gas Token:", data.data.gasToken);
    console.log("   Finality:", data.data.finality);
    console.log("   Contracts:", JSON.stringify(data.data.contracts, null, 2));

    console.log("\n💰 Step 3: Requesting second paid endpoint...");
    const statsResponse = await fetchWithPayment(`${API_BASE_URL}/api/arc-stats`);
    const stats = await statsResponse.json();
    console.log("✅ Stats received:");
    console.log("   Status:", stats.stats.status);
    console.log("   Explorer:", stats.stats.explorerUrl);
    console.log("   Docs:", stats.stats.docsUrl);

  } catch (error) {
    console.error("❌ Error:", error.message);
  }

  console.log("\n🎉 Agent completed successfully!");
}

runAgent().catch(console.error);
