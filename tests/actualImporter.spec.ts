import { ActualImporter, CompanyTypes } from "../src";
import * as fs from "fs";
import * as path from "path";
import { testConfig as exampleConfig } from "./config.test.example";

// Helper function to load test config
const loadTestConfig = () => {
  const configPath = path.join(__dirname, "config.test.ts");
  if (fs.existsSync(configPath)) {
    return require("./config.test").testConfig;
  }
  
  return exampleConfig;
};

describe("ActualImporter Tests", () => {
  describe("import", () => {
    it("should successfully import transactions from all scrapers", async () => {
      const config = loadTestConfig();

      if (!config) {
        console.warn("No config provided. Skipping test.");
        return;
      }
      
      const importer = new ActualImporter(config);
      const result = await importer.import();
      
      expect(result).toBe(true);
    }, 30000); // Increased timeout since scraping can take time
  });

  describe("createImportConfigForCron", () => {
    let getLastCronRunTimeSpy: jest.SpyInstance;

    beforeEach(() => {
      getLastCronRunTimeSpy = jest.spyOn(ActualImporter.prototype, "getLastCronRunTime");
    });

    afterEach(() => {
      getLastCronRunTimeSpy.mockRestore();
    });

    it("should use lastCronRunTime when it is more recent than scraper startDate", () => {
      // Arrange
      const lastCronRunTime = new Date("2023-01-01T00:00:00Z");
      const scraperStartDate = new Date("2021-01-01");
      getLastCronRunTimeSpy.mockReturnValue(lastCronRunTime);

      const importer = new ActualImporter({
        actualDataDir: "actualDataDir",
        actualPassword: "actualPassword",
        actualSyncId: "actualSyncId",
        actualUrl: "actualUrl",
        scrappers: [
          {
            actualAccountType: "checking",
            options: {
              startDate: scraperStartDate,
              companyId: CompanyTypes.yahav,
            },
            credentials: {
              username: "username",
              password: "password",
            },
          },
        ],
      });

      // Act
      const newConfig = importer.createImportConfigForCron();

      // Assert
      expect(newConfig.scrappers[0].options.startDate).toEqual(lastCronRunTime);
    });

    it("should keep scraper startDate when it is more recent than lastCronRunTime", () => {
      // Arrange
      const lastCronRunTime = new Date("2021-01-01T00:00:00Z");
      const scraperStartDate = new Date("2023-01-01");
      getLastCronRunTimeSpy.mockReturnValue(lastCronRunTime);

      const importer = new ActualImporter({
        actualDataDir: "actualDataDir",
        actualPassword: "actualPassword",
        actualSyncId: "actualSyncId",
        actualUrl: "actualUrl",
        scrappers: [
          {
            actualAccountType: "checking",
            options: {
              startDate: scraperStartDate,
              companyId: CompanyTypes.yahav,
            },
            credentials: {
              username: "username",
              password: "password",
            },
          },
        ],
      });

      // Act
      const newConfig = importer.createImportConfigForCron();

      // Assert
      expect(newConfig.scrappers[0].options.startDate).toEqual(scraperStartDate);
    });

    it("should use lastCronRunTime when scraper has no startDate", () => {
      // Arrange
      const lastCronRunTime = new Date("2023-01-01T00:00:00Z");
      getLastCronRunTimeSpy.mockReturnValue(lastCronRunTime);

      const importer = new ActualImporter({
        actualDataDir: "actualDataDir",
        actualPassword: "actualPassword",
        actualSyncId: "actualSyncId",
        actualUrl: "actualUrl",
        scrappers: [
          {
            actualAccountType: "checking",
            options: {
              companyId: CompanyTypes.yahav,
            } as any, // Using any to simulate missing startDate
            credentials: {
              username: "username",
              password: "password",
            },
          },
        ],
      });

      // Act
      const newConfig = importer.createImportConfigForCron();

      // Assert
      expect(newConfig.scrappers[0].options.startDate).toEqual(lastCronRunTime);
    });

    it("should keep scraper startDate when lastCronRunTime is not set", () => {
      // Arrange
      const scraperStartDate = new Date("2023-01-01T00:00:00Z");

      const importer = new ActualImporter({
        actualDataDir: "actualDataDir",
        actualPassword: "actualPassword",
        actualSyncId: "actualSyncId",
        actualUrl: "actualUrl",
        scrappers: [
          {
            actualAccountType: "checking",
            options: {
              startDate: scraperStartDate,
              companyId: CompanyTypes.yahav,
            },
            credentials: {
              username: "username",
              password: "password",
            },
          },
        ],
      });

      // Act
      const newConfig = importer.createImportConfigForCron();

      // Assert
      expect(newConfig.scrappers[0].options.startDate).toEqual(scraperStartDate);
    });
  });
});
