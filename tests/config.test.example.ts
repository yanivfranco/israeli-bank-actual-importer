import { ActualImporterConfig } from "../src/actualImporter";
import type { ScraperConfig } from "../src/scraper";
import { CompanyTypes } from "israeli-bank-scrapers";

export const testConfig: ActualImporterConfig = {
  actualSyncId: "example-sync-id",
  actualUrl: "http://localhost:5006",
  actualPassword: "example-password",
  actualDataDir: "./data",
  scrappers: [
    {
      actualAccountType: "checking" as const,
      options: {
        companyId: CompanyTypes.hapoalim,
        startDate: new Date("2024-01-01"),
      },
      credentials: {
        username: "example-username",
        password: "example-password",
        id: "example-id"
      }
    }
  ],
  shouldDownloadChromium: false,
  chromiumInstallPath: "./cache"
};
