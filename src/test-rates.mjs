import dotenv from "dotenv";
import { SwapKit } from "@circle-fin/swap-kit";
dotenv.config();

const kit = new SwapKit({ apiKey: process.env.CIRCLE_API_KEY });
const chains = kit.getSupportedChains();
const arc = chains.find(c => c.chain === "Arc_Testnet");
console.log("API key present:", !!process.env.CIRCLE_API_KEY);
try {
  const rates = await kit.getTokenRates({ chain: arc, token: "USDC" });
  console.log("rates:", JSON.stringify(rates, null, 2));
} catch(e) {
  console.log("error:", e.message);
}
