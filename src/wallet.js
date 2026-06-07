const { initiateDeveloperControlledWalletsClient } = require("@circle-fin/developer-controlled-wallets");
const dotenv = require("dotenv");

dotenv.config();

const client = initiateDeveloperControlledWalletsClient({
  apiKey: process.env.CIRCLE_API_KEY,
  entitySecret: process.env.CIRCLE_ENTITY_SECRET,
});

async function getWalletBalance() {
  const balance = await client.getWalletTokenBalance({
    id: process.env.CIRCLE_WALLET_ID,
  });
  return balance.data?.tokenBalances;
}

async function getWalletInfo() {
  const wallet = await client.getWallet({
    id: process.env.CIRCLE_WALLET_ID,
  });
  return wallet.data?.wallet;
}

module.exports = { client, getWalletBalance, getWalletInfo };
