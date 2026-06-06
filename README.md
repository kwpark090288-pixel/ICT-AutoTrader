# Trading Web

## Introduction

Trading Web is a Next.js-based trading dashboard and signal monitoring tool. It is designed to process market data, evaluate ICT-style trading conditions, display chart and alert information, and support automated signal routing workflows.

The project includes a web dashboard, indicator engines, alert panels, policy checks, trade lifecycle modules, Telegram notification utilities, and a background worker process.

## Key Features

- Real-time trading dashboard built with Next.js and React
- Candlestick chart UI powered by `lightweight-charts`
- ICT-style signal logic for FVG, Order Block, Trendline, and Channel conditions
- Policy layer for risk, regime, edge, cost, portfolio, and data-integrity checks
- Trade lifecycle handling for open, monitor, close, review, and persistence flows
- Alert and diagnostic panels for signal status and "why no open" analysis
- Telegram notification and dispatch utilities
- PostgreSQL and Prisma integration for data persistence
- Worker process for always-on background market and signal handling

## Usage

Install dependencies:

```bash
npm install
```

Create an environment file from the example:

```bash
cp .env.example .env
```

Run the development server:

```bash
npm run dev
```

Open the dashboard:

```text
http://localhost:3000
```

Run the background worker:

```bash
npm run worker:dev
```

Run lint checks:

```bash
npm run lint
```

Build for production:

```bash
npm run build
```

Start the production server:

```bash
npm run start
```

## License

MIT License
