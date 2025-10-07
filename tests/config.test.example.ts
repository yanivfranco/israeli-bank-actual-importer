import { CompanyTypes } from "israeli-bank-scrapers";
import { ActualImporterConfig } from "../src/actualImporter";

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
      retry: {
        initialDelay: 1000,
        maxDelay: 5000,
        maxRetries: 1,
      },
      credentials: {
        username: "example-username",
        password: "example-password",
        id: "example-id",
      },
    },
  ],
  shouldDownloadChromium: false,
  chromiumInstallPath: "./cache",
};
