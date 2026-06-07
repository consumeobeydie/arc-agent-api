const { paymentMiddleware } = require("x402-express");

const createX402Middleware = (sellerAddress) => {
  return paymentMiddleware(
    sellerAddress,
    {
      "/api/arc-data": {
        price: "$0.001",
        network: "base-sepolia",
        config: {
          description: "Arc Testnet network data and contract addresses",
        },
      },
      "/api/arc-stats": {
        price: "$0.001",
        network: "base-sepolia",
        config: {
          description: "Arc Testnet statistics and resources",
        },
      },
    },
    {
      facilitatorUrl: "https://facilitator.circle.com",
    }
  );
};

module.exports = { createX402Middleware };
