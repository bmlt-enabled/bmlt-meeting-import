#!/usr/bin/env node
/**
 * Convert a BMLT root server's meetings into a spreadsheet this tool can import.
 *
 *   node scripts/bmlt-to-naws.ts https://bmlt.example.org/main_server/
 *
 * Reads the public semantic interface -- no credentials needed -- and writes a
 * NAWS-style sheet you can review before importing it anywhere.
 */

import { writeFileSync } from 'node:fs';
import * as XLSX from 'xlsx';

import { BmltSourceClient } from '../src/lib/BmltSourceClient.ts';
import { exportToNAWSRows } from '../src/lib/NAWSExporter.ts';

interface Options {
  rootUrl: string;
  out: string;
  services: string[];
  recursive: boolean;
  includeUnpublished: boolean;
  timeZone: string;
  worldIdPrefix: string;
}

function usage(message?: string): never {
  if (message) {
    console.error(`Error: ${message}\n`);
  }

  console.error(`Usage: node scripts/bmlt-to-naws.ts <rootServerUrl> [options]

Options:
  --out <path>              Output file, .xlsx or .csv (default bmlt-naws-export.xlsx)
  --services <ids>          Only these source service body ids (comma separated)
  --recursive               With --services, include child service bodies
  --include-unpublished     Include unpublished meetings (they keep Published=FALSE)
  --timezone <IANA>         Fallback TimeZone for meetings that have none
  --world-id-prefix <text>  Infix for generated service body worldIds (default SB)
  -h, --help                Show this help

Example:
  node scripts/bmlt-to-naws.ts https://bmlt.namontana.org/main_server/ \\
    --out montana.xlsx --timezone America/Denver`);

  process.exit(message ? 1 : 0);
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    rootUrl: '',
    out: 'bmlt-naws-export.xlsx',
    services: [],
    recursive: false,
    includeUnpublished: false,
    timeZone: '',
    worldIdPrefix: 'SB'
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) {
        usage(`${arg} needs a value`);
      }
      return value;
    };

    if (arg === '--help' || arg === '-h') {
      usage();
    } else if (arg === '--out') {
      options.out = next();
    } else if (arg === '--services') {
      options.services = next()
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    } else if (arg === '--recursive') {
      options.recursive = true;
    } else if (arg === '--include-unpublished') {
      options.includeUnpublished = true;
    } else if (arg === '--timezone') {
      options.timeZone = next();
    } else if (arg === '--world-id-prefix') {
      options.worldIdPrefix = next();
    } else if (arg.startsWith('-')) {
      usage(`unknown option ${arg}`);
    } else if (!options.rootUrl) {
      options.rootUrl = arg;
    } else {
      usage(`unexpected argument ${arg}`);
    }
  }

  if (!options.rootUrl) {
    usage('a root server URL is required');
  }

  return options;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const rootUrl = BmltSourceClient.normalizeRootUrl(options.rootUrl);

  console.log(`Reading ${rootUrl}`);

  const source = await BmltSourceClient.fetchSource(rootUrl, {
    serviceBodyIds: options.services,
    recursive: options.recursive,
    includeUnpublished: options.includeUnpublished
  });

  if (source.meetings.length === 0) {
    throw new Error('No meetings returned. Check the root server URL and any --services filter.');
  }

  const result = exportToNAWSRows(source, {
    defaultTimeZone: options.timeZone,
    worldIdPrefix: options.worldIdPrefix
  });

  const sheet = XLSX.utils.aoa_to_sheet([result.columns, ...result.rows]);

  if (options.out.toLowerCase().endsWith('.csv')) {
    writeFileSync(options.out, XLSX.utils.sheet_to_csv(sheet));
  } else {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Meetings');
    // Write the buffer ourselves; XLSX.writeFile needs fs wired up under ESM
    writeFileSync(options.out, XLSX.write(book, { type: 'buffer', bookType: 'xlsx' }));
  }

  console.log(`\nWrote ${options.out}: ${result.rows.length} meetings`);

  if (result.unpublishedCount > 0) {
    console.log(`  ${result.unpublishedCount} unpublished (Published=FALSE)`);
  }

  if (result.generatedWorldIds.length > 0) {
    console.log(`\nGenerated worldIds for ${result.generatedWorldIds.length} service bodies that had none.`);
    console.log('Edit the AreaRegion column if the destination already has ids for these:');
    result.generatedWorldIds.forEach((area) => console.log(`  ${area.worldId.padEnd(12)} ${area.name}`));
  }

  if (result.formatsWithoutWorldId.length > 0) {
    console.log(`\nSource formats with no worldId (not exported): ${result.formatsWithoutWorldId.join(', ')}`);
  }

  if (result.unknownFormatIds.length > 0) {
    console.log(`\nFormat ids used by meetings but missing from GetFormats: ${result.unknownFormatIds.join(', ')}`);
  }

  if (result.truncatedFormats.length > 0) {
    console.log(`\n${result.truncatedFormats.length} meetings had more than 5 formats:`);
    result.truncatedFormats.forEach((row) => console.log(`  ${row.meetingName} - dropped ${row.dropped.join(', ')}`));
  }

  if (result.meetingsWithoutTimeZone > 0) {
    console.log(`\n${result.meetingsWithoutTimeZone} meetings have no time zone. Pass --timezone to set one.`);
  }
}

main().catch((error: unknown) => {
  console.error(`\nFailed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
