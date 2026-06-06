import "dotenv/config";

import { prisma } from "../lib/db/prisma";

async function main() {
  const rows = await prisma.tradePlan.findMany({
    where: {
      status: {
        in: ["OPEN", "CLOSING"],
      },
    },
    orderBy: {
      openedAt: "asc",
    },
    select: {
      planId: true,
      tradeKey: true,
      symbol: true,
      tf: true,
      source: true,
      poiTier: true,
      poiId: true,
      status: true,
      openedAt: true,
      closedAt: true,
    },
  });

  console.log(
    JSON.stringify(
      {
        count: rows.length,
        rows,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
