# Arc Intelligence API

A payment-gated API on Arc Testnet using the X402 protocol and Circle USDC.

## Overview

This project demonstrates how to build an X402 payment-gated API that serves Arc Testnet data. AI agents can autonomously pay for API access using USDC without human intervention.

## Architecture
## Network Details

| Parameter | Value |
|-----------|-------|
| Data Network | Arc Testnet |
| Chain ID | 5042002 |
| Gas Token | USDC |
| Payment Network | Base Sepolia |
| Payment Price | $0.001 USDC per request |

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values:
### 3. Start the server

```bash
npm start
```

### 4. Run the agent

```bash
npm run agent
```

## Endpoints

### Free Endpoints

| Endpoint | Description |
|----------|-------------|
| GET /health | Health check |
| GET /api/info | API information |

### Paid Endpoints (X402)

| Endpoint | Price | Description |
|----------|-------|-------------|
| GET /api/arc-data | $0.001 USDC | Arc Testnet network data |
| GET /api/arc-stats | $0.001 USDC | Arc Testnet statistics |

## How X402 Works

1. Agent sends request to paid endpoint
2. Server responds with HTTP 402 Payment Required
3. Agent signs USDC payment authorization
4. Agent resends request with X-PAYMENT header
5. Server verifies payment and returns data

## Arc Testnet Contract Addresses

| Contract | Address |
|----------|---------|
| USDC | 0x3600000000000000000000000000000000000000 |
| EURC | 0x3600000000000000000000000000000000000001 |
| Gateway Wallet | 0x0077777d7EBA4688BDeF3E311b846F25870A19B9 |

## Resources

- [Arc Documentation](https://docs.arc.io)
- [X402 Protocol](https://x402.org)
- [Circle Developer Console](https://console.circle.com)
- [Arc Testnet Explorer](https://testnet.arcscan.app)
- [Circle Faucet](https://faucet.circle.com)
