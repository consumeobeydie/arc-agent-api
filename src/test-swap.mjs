import dotenv from "dotenv";
import { SwapKit, getTokenRates, createSwapKitContext, getSupportedChains } from "@circle-fin/swap-kit";
dotenv.config();

const KIT_KEY = "KIT_KEY:9d17d86899a3df68734826bf4ff041f2:37c357165d4b5f987282af7975bea7ea";

const kit = new SwapKit();
const chains = kit.getSupportedChains();

console.log("Supported swap chains:", chains.map(c => c.chain).join(", "));

// getTokenRates ile Kit Key
console.log("\n📊 getTokenRates...");
try {
  const arc = chains.find(c => c.chain === "Arc_Testnet");
  const rates = await getTokenRates(kit.context, { chain: arc, token: "USDC", kitKey: KIT_KEY });
  console.log("✅ rates:", JSON.stringify(rates, null, 2));
} catch(e) {
  console.log("getTokenRates error:", e.message.slice(0, 150));
}

// getSwapStatus test
console.log("\n📊 getSwapStatus (dummy ID)...");
try {
  const status = await kit.getSwapStatus({ swapId: "test-swap-id", kitKey: KIT_KEY });
  console.log("status:", status);
} catch(e) {
  console.log("getSwapStatus error:", e.message.slice(0, 150));
}
