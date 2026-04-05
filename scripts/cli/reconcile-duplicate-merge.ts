/**
 * Повторне злиття дублікатів ЕТ ↔ IN-HEAT (після ручних правок або без повного імпорту).
 *
 *   npx tsx scripts/cli/reconcile-duplicate-merge.ts
 *   npx tsx scripts/cli/reconcile-duplicate-merge.ts --json > report.json
 */
import { PrismaClient } from "@prisma/client";
import { reconcileCrossSourceDuplicates } from "../lib/crossSourceDuplicateMerge";

const prisma = new PrismaClient();

async function main() {
  const json = process.argv.includes("--json");
  const report = await reconcileCrossSourceDuplicates(prisma, { quiet: json });
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  prisma.$disconnect();
  process.exit(1);
});
