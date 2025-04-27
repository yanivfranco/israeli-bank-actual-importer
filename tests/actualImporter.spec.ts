import { ActualImporter, CompanyTypes, ActualImporterConfig } from "../src";
import * as fs from "fs";
import * as path from "path";
import { testConfig as exampleConfig } from "./config.test.example";
import { Account } from "@actual-app/api";

// Helper function to create test configs
const createTestConfig = (overrides: Partial<ActualImporterConfig> = {}): ActualImporterConfig => ({
  actualDataDir: "actualDataDir",
  actualPassword: "actualPassword",
  actualSyncId: "actualSyncId",
  actualUrl: "actualUrl",
  scrappers: [
    {
      actualAccountType: "checking" as Account["type"],
      options: {
        startDate: new Date("2023-01-01T00:00:00Z"),
        companyId: CompanyTypes.yahav,
      },
      credentials: {
        username: "username",
        password: "password",
      },
    },
  ],
  ...overrides
});

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

      const importer = new ActualImporter(createTestConfig({
        scrappers: [
          {
            actualAccountType: "checking" as Account["type"],
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
      }));

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

      const importer = new ActualImporter(createTestConfig({
        scrappers: [
          {
            actualAccountType: "checking" as Account["type"],
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
      }));

      // Act
      const newConfig = importer.createImportConfigForCron();

      // Assert
      expect(newConfig.scrappers[0].options.startDate).toEqual(scraperStartDate);
    });

    it("should use lastCronRunTime when scraper has no startDate", () => {
      // Arrange
      const lastCronRunTime = new Date("2023-01-01T00:00:00Z");
      getLastCronRunTimeSpy.mockReturnValue(lastCronRunTime);

      const importer = new ActualImporter(createTestConfig({
        scrappers: [
          {
            actualAccountType: "checking" as Account["type"],
            options: {
              companyId: CompanyTypes.yahav,
            } as any, // Using any to simulate missing startDate
            credentials: {
              username: "username",
              password: "password",
            },
          },
        ],
      }));

      // Act
      const newConfig = importer.createImportConfigForCron();

      // Assert
      expect(newConfig.scrappers[0].options.startDate).toEqual(lastCronRunTime);
    });

    it("should keep scraper startDate when lastCronRunTime is not set", () => {
      // Arrange
      const scraperStartDate = new Date("2023-01-01T00:00:00Z");
      getLastCronRunTimeSpy.mockReturnValue(null);

      const importer = new ActualImporter(createTestConfig({
        scrappers: [
          {
            actualAccountType: "checking" as Account["type"],
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
      }));

      // Act
      const newConfig = importer.createImportConfigForCron();

      // Assert
      expect(newConfig.scrappers[0].options.startDate).toEqual(scraperStartDate);
    });

    it("should keep original startDate on first cron run when runOnInit is true", () => {
      // Arrange
      const scraperStartDate = new Date("2023-01-01T00:00:00Z");
      getLastCronRunTimeSpy.mockReturnValue(null); // Simulate first run - no lastCronRunTime

      const importer = new ActualImporter(createTestConfig({
        scrappers: [
          {
            actualAccountType: "checking" as Account["type"],
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
      }));

      // Act
      const newConfig = importer.createImportConfigForCron();

      // Assert
      expect(newConfig.scrappers[0].options.startDate).toEqual(scraperStartDate);
      expect(getLastCronRunTimeSpy).toHaveBeenCalled();
    });
  });

  describe("cronHandler", () => {
    let getLastCronRunTimeSpy: jest.SpyInstance;
    let processScraperSpy: jest.SpyInstance;
    let initSpy: jest.SpyInstance;

    beforeEach(() => {
      getLastCronRunTimeSpy = jest.spyOn(ActualImporter.prototype, "getLastCronRunTime");
      processScraperSpy = jest.spyOn(ActualImporter.prototype as any, "processScraper").mockResolvedValue(undefined);
      initSpy = jest.spyOn(ActualImporter.prototype, "init").mockResolvedValue();
    });

    afterEach(() => {
      getLastCronRunTimeSpy.mockRestore();
      processScraperSpy.mockRestore();
      initSpy.mockRestore();
    });

    it("should keep original startDate when processing scrapers on first cron run", async () => {
      // Arrange
      const scraperStartDate = new Date("2023-01-01T00:00:00Z");
      getLastCronRunTimeSpy.mockReturnValue(null); // Simulate first run - no lastCronRunTime

      const config = createTestConfig({
        scrappers: [
          {
            actualAccountType: "checking" as Account["type"],
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

      const importer = new ActualImporter(config);      

      // Act
      await importer["cronHandler"]();

      // Assert
      expect(processScraperSpy).toHaveBeenCalledWith(expect.objectContaining({
        options: expect.objectContaining({
          startDate: scraperStartDate
        })
      }));
    });
  });
});
