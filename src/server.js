const express = require("express");
const dotenv = require("dotenv");
const { createX402Middleware } = require("./middleware/x402");

dotenv.config();

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const SELLER_ADDRESS = "0x54b4B44749a95070560509B6Ec0be501665CcF63";

// X402 middleware - protects paid endpoints
app.use(createX402Middleware(SELLER_ADDRESS));

// Health check endpoint - free
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    network: "Arc Testnet",
    chainId: process.env.ARC_CHAIN_ID,
    timestamp: new Date().toISOString(),
  });
});

// Info endpoint - free
app.get("/api/info", (req, res) => {
  res.json({
    name: "Arc Intelligence API",
    version: "1.0.0",
    description: "X402 payment-gated API on Arc Testnet",
    network: {
      name: "Arc Testnet",
      chainId: 5042002,
      rpcUrl: "https://rpc.testnet.arc.network",
      explorer: "https://testnet.arcscan.app",
      gasToken: "USDC",
    },
    endpoints: {
      free: ["/health", "/api/info"],
      paid: ["/api/arc-data", "/api/arc-stats"],
    },
    payment: {
      price: "$0.001 USDC per request",
      network: "Arc Testnet",
      sellerAddress: SELLER_ADDRESS,
    },
  });
});

// Paid endpoint - protected by X402
app.get("/api/arc-data", (req, res) => {
  res.json({
    data: {
      network: "Arc Testnet",
      chainId: 5042002,
      gasToken: "USDC",
      finality: "sub-second deterministic",
      contracts: {
        USDC: "0x3600000000000000000000000000000000000000",
        EURC: "0x3600000000000000000000000000000000000001",
        GatewayWallet: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
      },
      features: [
        "EVM Compatible",
        "USDC Native Gas",
        "Sub-second Finality",
        "Malachite BFT Consensus",
        "Post-quantum Security",
      ],
    },
    timestamp: new Date().toISOString(),
  });
});

// Paid endpoint - protected by X402
app.get("/api/arc-stats", (req, res) => {
  res.json({
    stats: {
      network: "Arc Testnet",
      status: "active",
      explorerUrl: "https://testnet.arcscan.app",
      faucetUrl: "https://faucet.circle.com",
      docsUrl: "https://docs.arc.io",
    },
    timestamp: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`Arc Intelligence API running on port ${PORT}`);
  console.log(`Network: Arc Testnet (Chain ID: ${process.env.ARC_CHAIN_ID})`);
  console.log(`Seller address: ${SELLER_ADDRESS}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
});

module.exports = app;
