// npm run report:usage -- --date YYYY-MM-DD
//
// Prints the daily usage email for one Pacific day to the console instead of
// emailing it (lib/server/usageReport.ts builds both). Without --date, it prints
// yesterday's. Reads DATABASE_URL (from .env.local when there is one) and writes
// nothing: no claim, no email. The report names accounts and their emails, so
// it is for the database owner's own terminal.

import { getPool } from "@/lib/server/db";
import { addDays, isReportDate, pacificClock } from "@/lib/report/pacificDay";
import { formatUsageReport } from "@/lib/report/usageReport";
import { loadUsageReport } from "@/lib/server/usageReport";

function dateArg(argv: string[]): string {
  const at = argv.indexOf("--date");
  if (at === -1) return addDays(pacificClock(new Date()).date, -1);
  const value = argv[at + 1] ?? "";
  if (!isReportDate(value)) {
    console.error("Usage: npm run report:usage -- --date YYYY-MM-DD");
    process.exit(2);
  }
  return value;
}

const date = dateArg(process.argv.slice(2));
if (!process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL (in .env.local or the shell) to read the report.");
  process.exit(2);
}

try {
  const { subject, text } = formatUsageReport(await loadUsageReport(date));
  console.log(`Subject: ${subject}\n\n${text}`);
} catch (error) {
  console.error(`Could not read the report (${(error as { code?: string }).code ?? (error as Error).message}).`);
  process.exitCode = 1;
} finally {
  await getPool().end();
}
