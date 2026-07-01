/**
 * CCTP Bridge: Base Sepolia → Arc Testnet
 * Using Circle Wallets Adapter + Bridge Kit
 */
const { BridgeKit } = require("@circle-fin/bridge-kit");
const { createCircleWalletsAdapter } = require("@circle-fin/adapter-circle-wallets");
require("dotenv").config();

// BigInt serialization fix
BigInt.prototype.toJSON = function() { return this.toString(); };

const WALLET_ADDRESS = process.env.CIRCLE_WALLET_ADDRESS;
const ARC_WALLET_ADDRESS = "0xa75282fe398a4bf910884bdff29aeb1a23f2e55a";

async function main() {
  console.log("\n╔════════════════════════════════════════════╗");
  console.log("║  CCTP Bridge: Base Sepolia → Arc Testnet  ║");
  console.log("╚════════════════════════════════════════════╝");

  const adapter = createCircleWalletsAdapter({
    apiKey: process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
  });

  const kit = new BridgeKit();

  kit.on("*", (event) => {
    console.log(`  [event] ${event.type}:`, JSON.stringify(event).slice(0, 100));
  });

  console.log(`\nSource wallet:      ${WALLET_ADDRESS}`);
  console.log(`Destination wallet: ${ARC_WALLET_ADDRESS}`);

  // Estimate first
  console.log("\n📊 Estimating...");
  try {
    const estimate = await kit.estimate({
      from: { adapter, chain: "Ethereum_Sepolia", address: WALLET_ADDRESS },
      to: { adapter, chain: "Arc_Testnet", address: ARC_WALLET_ADDRESS },
      amount: "0.001",
      token: "USDC",
    });
    console.log("✅ Estimate:", JSON.stringify(estimate, null, 2));
  } catch(e) {
    console.log("Estimate error:", e.message);
  }

  // Bridge
  console.log("\n🌉 Bridging 0.001 USDC Base Sepolia → Arc Testnet...");
  try {
    const result = await kit.bridge({
      from: { adapter, chain: "Ethereum_Sepolia", address: WALLET_ADDRESS },
      to: { adapter, chain: "Arc_Testnet", address: ARC_WALLET_ADDRESS },
      amount: "0.001",
      token: "USDC",
    });
    console.log("\n🎉 Bridge result:", JSON.stringify(result, null, 2));
  } catch(e) {
    console.error("\n❌ Bridge error:", e.message);
  }
}

async function retry() {
  const adapter = createCircleWalletsAdapter({
    apiKey: process.env.CIRCLE_API_KEY,
    entitySecret: process.env.CIRCLE_ENTITY_SECRET,
  });
  const kit = new BridgeKit();
  kit.on("*", (event) => {
    if (event.type) console.log(`  [event] ${event.type}`);
  });
  // Retry last failed bridge using attestation
  const attestation = "0x467049bbff5d6994e63f0ed3537e0efe4cd7a0d08845b2b16071269d13eb974d6d033e8b7d80d2c52c4692812bf9b52d6ab25ad571d51c42c705a7d64ee6927a1cb42196a9ac3702da10a3e65e21a5493d31b270a547762b6a6defaa6338b45d355282fb08379e8a7205466edd2c4c4268ab6ce45ee66c282009085180b63f97fb1c";
  const message = "0x00000001000000000000001a6abfcace8b4d1e44ebe338cc42f962187f5e7d1343edb10d107b678ffd7881cd0000000000000000000000008fe6b999dc680ccfdd5bf7eb0974218be2542daa0000000000000000000000008fe6b999dc680ccfdd5bf7eb0974218be2542daa0000000000000000000000000000000000000000000000000000000000000000000003e8000003e8000000010000000000000000000000001c7d4b196cb0c7b01d743fbc6116a902379c7238000000000000000000000000a75282fe398a4bf910884bdff29aeb1a23f2e55a00000000000000000000000000000000000000000000000000000000000003e8000000000000000000000000c5567a5e3370d4dbfb0540025078e283e36a363d000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000002f8427f";

  console.log("\n🔄 Retrying mint step...");
  try {
    const destAdapter = { adapter, chain: "Arc_Testnet", address: "0xa75282fe398a4bf910884bdff29aeb1a23f2e55a" };
    const result = await kit.retry(
      { state: "error", steps: [{ name: "mint", state: "error" }], source: { chain: { chain: "Ethereum_Sepolia" } }, destination: { chain: { chain: "Arc_Testnet" }, address: "0xa75282fe398a4bf910884bdff29aeb1a23f2e55a" } },
      destAdapter
    );
    console.log("Retry result:", JSON.stringify(result, null, 2));
  } catch(e) {
    console.error("Retry error:", e.message);
  }
}

retry().catch(console.error);
