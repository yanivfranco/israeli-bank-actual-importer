import { ActualImporter, CompanyTypes } from "../src";

describe("ActualImporter Tests", () => {
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
      const newConfig = importer.createImportConfigForCron({ cronTime: "daily" });

      // Assert the expected outcome
      expect(newConfig.scrappers[0].options.startDate).toEqual(new Date("2023-01-01T00:00:00Z"));
    });
  });
});
