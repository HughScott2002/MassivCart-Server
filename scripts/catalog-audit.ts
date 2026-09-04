// Measure how much of a GTIN list Open Food Facts can cover with usable images:
//   npx tsx scripts/catalog-audit.ts gtins.txt
//   npx tsx scripts/catalog-audit.ts gtins.txt --json > coverage.json
//
// Input is one GTIN per line; blank lines and lines starting with # are ignored.
// Set CATALOG_USER_AGENT to identify yourself — Open Food Facts throttles clients
// that do not, and returns HTML error pages instead of JSON.
import "dotenv/config";
import { readFileSync } from "node:fs";
import { auditCoverage, openFoodFactsLookup, type CoverageReport } from "../src/catalog/index.js";

const DEFAULT_USER_AGENT = "MassivCart-CoverageAudit/0.1 (https://github.com/HughScott2002/MassivCart-Server)";

function parseGtinFile(path: string): string[] {
  return readFileSync(path, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function printTable(report: CoverageReport): void {
  console.log("");
  console.log("gtin           img  brand                name");
  console.log("-------------- ---  -------------------  ----------------------------------");
  for (const row of report.rows) {
    const mark = row.error ? "err" : row.hasImage ? " ✓ " : " · ";
    const brand = (row.brand ?? "—").slice(0, 19).padEnd(19);
    const name = row.error ? `(${row.error.kind})` : (row.name ?? "—");
    console.log(`${row.gtin.padEnd(14)} ${mark}  ${brand}  ${name.slice(0, 34)}`);
  }

  console.log("");
  console.log(`requested      ${report.requested}`);
  console.log(`invalid gtin   ${report.invalidGtins}`);
  console.log(`found          ${report.found}`);
  console.log(`with image     ${report.withImage}`);
  console.log(`failed         ${report.failed}`);
  console.log(`coverage       ${report.coveragePct}%  (of ${report.requested - report.failed} measurable)`);
  console.log("");
}

async function main(): Promise<void> {
  const path = process.argv[2];
  const asJson = process.argv.includes("--json");

  if (!path) {
    console.error("Usage: npx tsx scripts/catalog-audit.ts <gtin-file> [--json]");
    process.exit(1);
  }

  const gtins = parseGtinFile(path);
  if (gtins.length === 0) {
    console.error(`No GTINs found in ${path}`);
    process.exit(1);
  }

  const lookup = openFoodFactsLookup({
    userAgent: process.env.CATALOG_USER_AGENT ?? DEFAULT_USER_AGENT,
  });

  console.error(`auditing ${gtins.length} GTINs against Open Food Facts (serial, ~1/sec)`);
  const report = await auditCoverage(gtins, lookup, {
    log: (message, context) => console.error(`[catalog] ${message}`, JSON.stringify(context)),
  });

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printTable(report);
  }

  // Non-zero when nothing could be measured at all — a signal for CI or a wrapper.
  process.exit(report.requested === report.failed ? 2 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
