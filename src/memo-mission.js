const { createWalletClient, createPublicClient, http, keccak256, toHex, encodeFunctionData } = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
require("dotenv").config();

const arcTestnet = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.arc.network"] } },
  testnet: true,
};

const MEMO_CONTRACT = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505";
const USDC_ERC20 = "0x3600000000000000000000000000000000000000";

const memoAbi = [{
  name: "callWithMemo",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { name: "target", type: "address" },
    { name: "data", type: "bytes" },
    { name: "correlationId", type: "bytes32" },
    { name: "memo", type: "string" },
  ],
  outputs: [
    { name: "success", type: "bool" },
    { name: "result", type: "bytes" },
  ],
}];

const erc20Abi = [{
  name: "transfer",
  type: "function",
  stateMutability: "nonpayable",
  inputs: [
    { name: "to", type: "address" },
    { name: "amount", type: "uint256" },
  ],
  outputs: [{ name: "", type: "bool" }],
}];

const account = privateKeyToAccount("0x" + process.env.SELLER_PRIVATE_KEY);
const publicClient = createPublicClient({ chain: arcTestnet, transport: http() });
const walletClient = createWalletClient({ account, chain: arcTestnet, transport: http() });

async function main() {
  console.log("\n=== Arc Transaction Memo: Multi-Agent Mission Audit Trail ===");
  console.log("Memo Contract:  " + MEMO_CONTRACT);
  console.log("Target (USDC):  " + USDC_ERC20);
  console.log("Caller:         " + account.address);
  console.log("================================================================\n");

  const missionId = 2n;

  const innerCalldata = encodeFunctionData({
    abi: erc20Abi,
    functionName: "transfer",
    args: [account.address, 1n],
  });

  const correlationId = keccak256(toHex("arc-multi-agent-mission-" + missionId + "-audit-" + Date.now()));
  const memoText = "ARC-AGENT-MISSION-" + missionId + "-AUDIT-" + Date.now() + "-CLAUDE";

  console.log("Correlation ID: " + correlationId);
  console.log("Memo text:      " + memoText);
  console.log("\nSubmitting callWithMemo() ...");

  const hash = await walletClient.writeContract({
    address: MEMO_CONTRACT,
    abi: memoAbi,
    functionName: "callWithMemo",
    args: [USDC_ERC20, innerCalldata, correlationId, memoText],
    account,
  });

  console.log("Tx submitted: " + hash);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("\nStatus: " + receipt.status);
  console.log("Block:  " + receipt.blockNumber);
  console.log("Logs:   " + receipt.logs.length);
  console.log("\nExplorer: https://testnet.arcscan.app/tx/" + hash);
}

main().catch((e) => {
  console.error("Error:", e.shortMessage || e.message);
  process.exit(1);
});