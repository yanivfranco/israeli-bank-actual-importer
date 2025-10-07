# israeli-bank-actual-importer

Israeli banks importer for https://actualbudget.org/.

## Features

### Retry Configuration

The importer supports configurable retry logic for handling transient failures during scraping, account creation, and transaction imports.

#### Global Retry Configuration

You can set a global retry configuration that applies to all scrapers:

```typescript
const config: ActualImporterConfig = {
  // ... other config
  retry: {
    maxRetries: 3, // Number of retry attempts
    initialDelay: 1000, // Initial delay in ms
    maxDelay: 10000, // Maximum delay in ms (uses exponential backoff)
  },
};
```

#### Per-Account Retry Configuration

You can override retry settings for specific accounts:

```typescript
const config: ActualImporterConfig = {
  // ... other config
  retry: {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
  },
  scrappers: [
    {
      // This scraper uses the global retry config
      actualAccountType: "checking",
      options: {
        /* ... */
      },
      credentials: {
        /* ... */
      },
    },
    {
      // This scraper uses a custom retry config
      actualAccountType: "credit",
      options: {
        /* ... */
      },
      credentials: {
        /* ... */
      },
      retry: {
        maxRetries: 5, // More retries for this account
        initialDelay: 2000,
        maxDelay: 20000,
      },
    },
    {
      // This scraper has retry disabled
      actualAccountType: "savings",
      options: {
        /* ... */
      },
      credentials: {
        /* ... */
      },
      retry: false, // No retries for this account
    },
  ],
};
```

**Default behavior**: If no retry configuration is provided, the system defaults to 1 retry attempt with 1000ms initial delay and 10000ms max delay.

## Development

### Testing

The project includes tests that verify the importing functionality. To run the tests with your own bank credentials:

1. Copy the example test config:

   ```bash
   cp tests/config.test.example.ts tests/config.test.ts
   ```

2. Edit `tests/config.test.ts` with your actual credentials and configuration:
   - `actualSyncId`: Your Actual budget sync ID
   - `actualPassword`: Your Actual password
   - `scrappers`: Configure your bank scraper(s) with:
     - `credentials`: Your bank login credentials
     - Other options as needed

**Note:** `tests/config.test.ts` is git-ignored to prevent committing sensitive data. The example config at `tests/config.test.example.ts` is used as a fallback for CI/CD builds.

3. Run tests:
   ```bash
   npm test
   ```
