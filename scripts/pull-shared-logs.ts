// Pulls the shared game logs out of the database into a folder, one replayable
// log per game with what is known about it beside it:
//
//   MIGRATION_DATABASE_URL=<the owner's URL> npm run pull:logs -- ~/SpotterTestSet/shared [--since 2026-10-12]
//
// The URL is the database owner's (the app's own role cannot read these
// tables): Railway's Postgres service, Variables, DATABASE_PUBLIC_URL. Set it
// in your own shell for the one command; never paste it into a chat or a file.
//
// Each share becomes shared-<UTC date and time>-<id>.json, which
// `npm run check:cards`, `replay:stats` and `score:stats` read like a
// downloaded log (lib/log/sharedReplay.ts), and .meta.json beside it: the
// sport, the settings, the counts, the rating, whether End game reached it,
// and any piece that never arrived. A file already there is left alone, so
// running it again pulls only what is new.
//
// PRIVACY: the logs keep players' last names, many of them minors'. It refuses
// a folder inside this repository (.gitignore and
// test/testSetNotTracked.test.ts hold the line from the other side), and
// prints counts only.

import { existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import pg from "pg";
import { isInside } from "@/lib/livestats/score";
import { joinShare, shareMeta, sharedFileBase, type PulledShare } from "@/lib/log/sharedPull";
import { sslFor } from "@/scripts/ssl.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

const args = process.argv.slice(2);
const sinceAt = args.indexOf("--since");
const since = sinceAt >= 0 ? args[sinceAt + 1] : null;
if (since !== null && !/^\d{4}-\d{2}-\d{2}$/.test(since ?? "")) fail("--since takes a date: --since 2026-10-12");
const folderArg = args.find((arg, index) => !arg.startsWith("--") && index !== sinceAt + 1);
if (!folderArg) fail("Usage: npm run pull:logs -- <folder outside the repo> [--since YYYY-MM-DD]");

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) fail("Set MIGRATION_DATABASE_URL to the database owner's URL in your shell for this command.");

mkdirSync(folderArg, { recursive: true });
const folder = realpathSync(folderArg);
if (isInside(folder, realpathSync(REPO_ROOT))) {
  fail(`${folder} is inside this repository. Shared logs name high school players and must never be committed; pull them to a folder outside the repo (for example ~/SpotterTestSet/shared).`);
}

const gunzip = (base64: string) => gunzipSync(Buffer.from(base64, "base64")).toString("utf8");

const client = new pg.Client({ connectionString: url, ssl: sslFor(url) });
await client.connect();
try {
  const { rows } = await client.query(
    `select id, share_id, created_at, sport, stats_enabled, scrub_version, complete, pieces, records,
            app_commit, header, counts, rating, blockers, log_gz_b64
     from shared_game_logs
     where $1::date is null or created_at >= $1::date
     order by created_at`,
    [since],
  );
  let written = 0;
  let skipped = 0;
  let incomplete = 0;
  for (const row of rows) {
    const share: PulledShare = {
      id: row.id,
      shareId: row.share_id,
      createdAt: row.created_at,
      sport: row.sport,
      statsEnabled: row.stats_enabled,
      scrubVersion: row.scrub_version,
      complete: row.complete,
      pieces: row.pieces,
      records: row.records,
      appCommit: row.app_commit,
      header: row.header,
      counts: row.counts,
      rating: row.rating,
      blockers: row.blockers,
      wholeLog: row.log_gz_b64,
    };
    const base = path.join(folder, sharedFileBase(share));
    if (existsSync(`${base}.json`)) {
      skipped += 1;
      continue;
    }
    const pieces =
      share.shareId === null
        ? []
        : (
            await client.query("select part, log_gz_b64 from shared_game_log_pieces where share_id = $1 order by part", [share.shareId])
          ).rows.map((piece) => ({ part: piece.part as number, logGzB64: piece.log_gz_b64 as string }));
    const { log, missingParts } = joinShare(share, pieces, gunzip);
    writeFileSync(`${base}.json`, JSON.stringify(log));
    writeFileSync(`${base}.meta.json`, `${JSON.stringify(shareMeta(share, missingParts), null, 2)}\n`);
    written += 1;
    if (share.shareId !== null && (!share.complete || missingParts.length > 0)) incomplete += 1;
  }
  console.log(`${rows.length} shared logs: ${written} written, ${skipped} already there, ${incomplete} of the new ones not complete.`);
  if (written > 0) console.log(`In ${folder}. Replay one with: npm run check:cards -- <file>.json`);
} finally {
  await client.end();
}
