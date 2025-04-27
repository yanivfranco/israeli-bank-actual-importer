# israeli-bank-actual-importer

Israeli banks importer for https://actualbudget.org/.

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
