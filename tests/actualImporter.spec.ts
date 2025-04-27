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
    it("should override startDate if exists from lastCronRunTime", () => {
      // Arrange
      const spy = jest
        .spyOn(ActualImporter.prototype, "getLastCronRunTime")
        .mockReturnValue(new Date("2023-01-01T00:00:00Z"));
      const importer = new ActualImporter({
        actualDataDir: "actualDataDir",
        actualPassword: "actualPassword",
        actualSyncId: "actualSyncId",
        actualUrl: "actualUrl",
        scrappers: [
          {
            actualAccountType: "checking",
            options: {
              startDate: new Date("2021-01-01"),
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
      const newConfig = importer.createImportConfigForCron()

      // Assert the expected outcome
      expect(newConfig.scrappers[0].options.startDate).toEqual(new Date("2023-01-01T00:00:00Z"));
    });
  });
});
