# israeli-bank-actual-importer

Import transactions from Israeli banks and credit card companies into
[Actual Budget](https://actualbudget.org/), on a schedule.

It glues together two things: [`israeli-bank-scrapers`](https://github.com/eshaham/israeli-bank-scrapers)
(which logs into your bank with a headless browser and pulls transactions) and the
Actual Budget API (which stores them). You give it credentials and a sync ID; it
keeps your budget up to date.

## What it actually does

On each run, for every configured scraper:

1. **Scrapes** the bank/card site for transactions since a computed start date.
2. **Matches** each scraped account to an Actual account, creating it if missing.
3. **Imports** the transactions, letting Actual deduplicate them.

Two details worth understanding before you use it:

**Account matching uses notes, not names.** When the importer creates an account
it writes a note on it: `#externalAccountNumber:<number> DO NOT DELETE`. On later
runs it finds the account by searching for that note. Renaming an account in
Actual is safe. Deleting that note is not — the importer will stop recognising the
account and create a duplicate.

**Deduplication is Actual's job, not the importer's.** Every transaction is sent
with `imported_id` set to the scraper's stable identifier. Re-importing the same
date range is therefore safe and cheap: Actual updates matches instead of
inserting duplicates. Transactions the scraper returns without an identifier are
skipped, with a warning.

Newly created accounts get an opening balance derived from the scraped balance
minus the sum of imported transactions, so the account reconciles.

## Install

```bash
npm install israeli-bank-actual-importer
```

Requires Node 18+ and a reachable Actual Budget server.

## Quick start

```typescript
import { ActualImporter, CompanyTypes } from "israeli-bank-actual-importer";

const importer = new ActualImporter({
  actualSyncId: "your-budget-sync-id",
  actualUrl: "http://localhost:5006",
  actualPassword: "your-actual-password",
  actualDataDir: "./data",
  scrappers: [
    {
      actualAccountType: "checking",
      options: {
        companyId: CompanyTypes.discount,
        startDate: new Date("2024-01-01"),
      },
      credentials: { id: "...", password: "...", num: "..." },
    },
  ],
});

// One-off import, then shut down
await importer.import();
```

Credential shapes differ per bank — see the
[israeli-bank-scrapers docs](https://github.com/eshaham/israeli-bank-scrapers#specific-definitions-per-scraper).

### Scheduled imports

```typescript
// Every day at 03:00 Israel time
await importer.cron("0 3 * * *", { timeZone: "Asia/Jerusalem", runOnInit: true });
```

`cron()` keeps the process alive and imports on schedule. `runOnInit` triggers an
immediate first run.

## Choosing how far back to scrape

The `startDate` you pass is a floor, not the value actually used. Scraping a year
of history every run is slow, so the importer narrows the window per account using
`startDateStrategy`:

**`"lastCronRunTime"` (default)** — resumes from the last successful cron run,
minus 3 days. State lives in `./cache/lastCronRunTime`. Delete that file and it
falls back to your configured `startDate`.

**`"lastTransaction"`** — looks up the newest transaction already in Actual for
each account and starts `startDateBufferDays` before it. This is per-account, so a
card that lags behind doesn't hold back the others.

```typescript
{
  startDateStrategy: "lastTransaction",
  startDateBufferDays: 7,   // default 7
  maxMonthsBack: 12,        // default 12 — used when an account has no transactions yet
}
```

The buffer is a safety margin, not a lookback window: it exists because banks
sometimes post a transaction days after its effective date. Widen it if you see
transactions appearing with dates earlier than your last import; each extra day
costs scrape time but nothing else, since Actual deduplicates.

If a computed start date lands in the future (a bank reporting a post-dated
transaction), it's clamped to now minus the buffer.

## Configuration

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `actualSyncId` | `string` | — | Budget sync ID (Actual → Settings → Advanced) |
| `actualUrl` | `string` | — | Actual server URL |
| `actualPassword` | `string` | — | Actual server password |
| `actualDataDir` | `string` | — | Local cache dir for the Actual API |
| `scrappers` | `ScraperConfig[]` | — | One entry per bank/card account |
| `startDateStrategy` | `"lastCronRunTime" \| "lastTransaction"` | `"lastCronRunTime"` | How the start date is computed |
| `startDateBufferDays` | `number` | `7` | Days before the last transaction (`lastTransaction` only) |
| `maxMonthsBack` | `number` | `12` | Fallback window for accounts with no transactions |
| `retry` | `RetryConfig` | 1 attempt | Global retry policy |
| `cleanup` | `boolean` | `false` | Run cleanup before importing |
| `shouldDownloadChromium` | `boolean` | `false` | Download Chromium at startup (useful in containers) |
| `chromiumInstallPath` | `string` | — | Where to install it |
| `showLogs` | `boolean` | `true` | Set `false` to silence the logger |

### Per-scraper options

| Option | Type | Description |
| --- | --- | --- |
| `options` | `ScraperOptions` | Passed to israeli-bank-scrapers (`companyId`, `startDate`, …) |
| `credentials` | `ScraperCredentials` | Bank login details |
| `actualAccountType` | `"checking" \| "credit" \| "savings" \| …` | Type used when creating the account |
| `shouldUseCache` | `boolean` | Cache scrape results to `./cache` — handy while developing |
| `retry` | `RetryConfig \| false` | Override the global retry policy, or disable it |

### Retries

Scraping, account creation, and import are each retried independently with
exponential backoff (`initialDelay * 2^attempt`, capped at `maxDelay`).

```typescript
{
  retry: { maxRetries: 3, initialDelay: 1000, maxDelay: 10000 },
}
```

Set `retry: false` on a scraper to disable retries for that account — useful for
accounts where a failed login risks a lockout. Default without config: a single
attempt.

### Hooks

Callbacks for notifications or logging:

```typescript
{
  onImportSuccess: ({ accountName, added, updated, startDate }) =>
    console.log(`${accountName}: +${added.length} ~${updated.length}`),
  onImportError: ({ companyId, error }) => notify(companyId, error),
  onImportFinish: () => {},
  onCronStart: () => {},
  onCronFinish: () => {},
}
```

`onImportSuccess` fires per account; `added` and `updated` are arrays of
transaction IDs.

## Running in Docker

Bank scrapers need a real Chromium. Either install one in the image and let
Puppeteer find it, or set `shouldDownloadChromium: true` with a writable
`chromiumInstallPath` on a persistent volume so it isn't re-downloaded on every
restart.

Mount `actualDataDir` and `./cache` on a volume too: the former holds the Actual
budget cache, the latter the cron timestamp and any cached scrapes.

## Troubleshooting

**A duplicate account appeared.** The `#externalAccountNumber:… DO NOT DELETE`
note was removed or edited. Restore it on the original account and merge the
duplicate.

**Nothing is imported and no error is shown.** With `lastCronRunTime`, the start
date may already be past the transactions you expect. Delete
`./cache/lastCronRunTime` to fall back to the configured `startDate`.

**Transactions appear late.** Increase `startDateBufferDays`; credit cards often
post with backdated effective dates.

**Login fails only in the container.** Usually a missing or mismatched Chromium.
Check `shouldDownloadChromium` / `chromiumInstallPath`.

## Development

```bash
yarn install
yarn build
```

Tests run against real banks, so they need real credentials:

```bash
cp tests/config.test.example.ts tests/config.test.ts
# edit tests/config.test.ts
npm test
```

`tests/config.test.ts` is git-ignored. The example file is used as a fallback in CI.

Releases are automated with semantic-release on merge to `main`, published to npm
with provenance via OIDC trusted publishing.

## License

MIT
