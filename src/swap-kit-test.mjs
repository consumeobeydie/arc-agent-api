/**
 * Swap Kit Test — Arc Testnet
 * Sprint 5: cross-chain swap, getTokenRates, waitForSwap
 */
import { SwapKit } from "@circle-fin/swap-kit";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import * as dotenv from "dotenv";
dotenv.config();

BigInt.prototype.toJSON = function() { return this.toString(); };

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║   Swap Kit Test — Arc Testnet            ║");
  console.log("╚══════════════════════════════════════════╝\n");

  const adapter = createCircleWalletsAdapter({
    apiKey: process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
  });

  const KIT_KEY = "KIT_KEY:9d17d86899a3df68734826bf4ff041f2:37c357165d4b5f987282af7975bea7ea";
  const kit = new SwapKit();

  // Step 1: getSupportedChains
  console.log("📊 Step 1: getSupportedChains...");
  try {
    const chains = kit.getSupportedChains();
    const arcChain = chains.find(c => c.chain === "Arc_Testnet");
    console.log("Arc Testnet:", arcChain ? "✅ Supported" : "❌ Not found");
    console.log("Total chains:", chains.length);
    console.log("Testnet chains:", chains.filter(c => c.isTestnet).map(c => c.chain).join(", "));
  } catch(e) {
    console.log("getSupportedChains error:", e.message);
  }

  // Step 2: getTokenRates
  console.log("\n📊 Step 2: getTokenRates...");
  try {
    const rates = await kit.getTokenRates([{ chain: "Arc_Testnet", token: "USDC" }, { chain: "Ethereum", token: "USDC" }]);
    console.log("✅ Token rates:", JSON.stringify(rates, null, 2));
  } catch(e) {
    console.log("getTokenRates error:", e.message);
  }

  // Step 3: estimate swap
  console.log("\n📊 Step 3: estimate swap...");
  try {
    const chains = kit.getSupportedChains();
    const arcChain = chains.find(c => c.chain === "Arc_Testnet");
    const ethChain = chains.find(c => c.chain === "Ethereum");
    const estimate = await kit.estimate({
      from: { adapter, chain: arcChain },
      tokenIn: "USDC",
      tokenOut: "USDC",
      amountIn: "0.001",
      to: { chain: "Ethereum" },
    });
    console.log("✅ Estimate:", JSON.stringify(estimate, null, 2));
  } catch(e) {
    console.log("estimate error:", e.message);
  }
}

main().catch(console.error);
