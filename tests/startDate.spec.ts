import { ActualImporter, ActualImporterConfig, CompanyTypes, StartDateStrategy } from "../src";
import { Account } from "@actual-app/api";
import * as fs from "fs";

// Setup navigator for @actual-app/api
globalThis.navigator = { platform: "linux", userAgent: "" } as any;

const createTestConfig = (overrides: Partial<ActualImporterConfig> = {}): ActualImporterConfig => ({
  actualDataDir: "actualDataDir",
  actualPassword: "actualPassword",
  actualSyncId: "actualSyncId",
  actualUrl: "actualUrl",
  scrappers: [
    {
      actualAccountType: "checking" as Account["type"],
      options: {
        startDate: new Date("2024-06-10T00:00:00Z"),
        companyId: CompanyTypes.discount,
      },
      credentials: {
        id: "id",
        password: "password",
        num: "num",
      },
    },
  ],
  ...overrides,
});

describe("Start Date Resolution", () => {
  let getLastCronRunTimeSpy: jest.SpyInstance;

  beforeEach(() => {
    getLastCronRunTimeSpy = jest.spyOn(ActualImporter.prototype, "getLastCronRunTime");
  });

  afterEach(() => {
    getLastCronRunTimeSpy.mockRestore();
  });

  describe("getLastCronRunTime", () => {
    it("should return null when cache file does not exist", () => {
      const importer = new ActualImporter(createTestConfig());
      // Override the file path to a non-existent location
      (importer as any).lastCronRunTimeFilePath = "./cache/nonexistent";
      
      const result = importer.getLastCronRunTime();
      expect(result).toBeNull();
    });

    it("should return date minus 3 days when cache file exists", () => {
      const now = new Date("2026-06-01T08:00:00Z");
      const cachePath = "./cache/testLastCronRunTime";
      
      // Write a test cache file
      if (!fs.existsSync("./cache")) fs.mkdirSync("./cache", { recursive: true });
      fs.writeFileSync(cachePath, now.toISOString());
      
      const importer = new ActualImporter(createTestConfig());
      (importer as any).lastCronRunTimeFilePath = cachePath;
      
      const result = importer.getLastCronRunTime();
      const expected = new Date(now.getTime() - 1000 * 60 * 60 * 24 * 3); // 3 days before
      expect(result).toEqual(expected);
      
      // Cleanup
      fs.unlinkSync(cachePath);
    });
  });

  describe("createImportConfigForCron with multiple scrapers", () => {
    it("should resolve startDate independently per scraper", () => {
      const lastCronRunTime = new Date("2026-05-20T00:00:00Z");
      getLastCronRunTimeSpy.mockReturnValue(lastCronRunTime);

      const oldStartDate = new Date("2024-06-10T00:00:00Z");
      const recentStartDate = new Date("2026-06-01T00:00:00Z");

      const importer = new ActualImporter(createTestConfig({
        scrappers: [
          {
            actualAccountType: "checking" as Account["type"],
            options: { startDate: oldStartDate, companyId: CompanyTypes.discount },
            credentials: { id: "id", password: "pass", num: "num" },
          },
          {
            actualAccountType: "credit" as Account["type"],
            options: { startDate: recentStartDate, companyId: CompanyTypes.visaCal },
            credentials: { username: "user", password: "pass" },
          },
        ],
      }));

      const config = importer.createImportConfigForCron();

      // Old startDate → replaced by lastCronRunTime (more recent)
      expect(config.scrappers[0].options.startDate).toEqual(lastCronRunTime);
      // Recent startDate → kept (more recent than lastCronRunTime)
      expect(config.scrappers[1].options.startDate).toEqual(recentStartDate);
    });

    it("should use hardcoded startDate when no lastCronRunTime (simulates container restart)", () => {
      getLastCronRunTimeSpy.mockReturnValue(null); // file doesn't exist

      const hardcodedDate = new Date("2024-06-10T00:00:00Z");
      const importer = new ActualImporter(createTestConfig({
        scrappers: [
          {
            actualAccountType: "checking" as Account["type"],
            options: { startDate: hardcodedDate, companyId: CompanyTypes.discount },
            credentials: { id: "id", password: "pass", num: "num" },
          },
        ],
      }));

      const config = importer.createImportConfigForCron();

      // Falls back to hardcoded date — this is the bug we're fixing
      expect(config.scrappers[0].options.startDate).toEqual(hardcodedDate);
    });
  });

  describe("updateLastCronRunTime", () => {
    it("should write current timestamp to cache file", () => {
      const cachePath = "./cache/testUpdateCron";
      if (!fs.existsSync("./cache")) fs.mkdirSync("./cache", { recursive: true });

      const importer = new ActualImporter(createTestConfig());
      (importer as any).lastCronRunTimeFilePath = cachePath;

      const before = new Date();
      (importer as any).updateLastCronRunTime();
      const after = new Date();

      const written = new Date(fs.readFileSync(cachePath, "utf8"));
      expect(written.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(written.getTime()).toBeLessThanOrEqual(after.getTime());

      // Cleanup
      fs.unlinkSync(cachePath);
    });
  });
});

describe("Retry Logic", () => {
  it("should retry failed operations up to maxRetries", async () => {
    const initSpy = jest.spyOn(ActualImporter.prototype, "init").mockResolvedValue();
    
    let attempts = 0;
    const processScraperSpy = jest.spyOn(ActualImporter.prototype as any, "processScraper")
      .mockImplementation(async () => {
        attempts++;
        if (attempts < 3) throw new Error("temporary failure");
      });

    const importer = new ActualImporter(createTestConfig({
      retry: { maxRetries: 3, initialDelay: 10, maxDelay: 50 },
    }));

    // The retry is inside processScraper, but we're mocking it at that level
    // So let's test retryOperation directly
    const retryOp = (importer as any).retryOperation.bind(importer);
    
    let opAttempts = 0;
    const result = await retryOp(
      async () => { opAttempts++; if (opAttempts < 3) throw new Error("fail"); return "ok"; },
      "test operation",
      { maxRetries: 3, initialDelay: 10, maxDelay: 50 }
    );

    expect(result).toBe("ok");
    expect(opAttempts).toBe(3);

    initSpy.mockRestore();
    processScraperSpy.mockRestore();
  });

  it("should throw after all retries exhausted", async () => {
    const importer = new ActualImporter(createTestConfig());
    const retryOp = (importer as any).retryOperation.bind(importer);

    await expect(retryOp(
      async () => { throw new Error("permanent failure"); },
      "doomed operation",
      { maxRetries: 2, initialDelay: 10, maxDelay: 50 }
    )).rejects.toThrow("All 2 attempts failed for doomed operation");
  });

  it("should skip retry when retry config is false", async () => {
    const importer = new ActualImporter(createTestConfig());
    const retryOp = (importer as any).retryOperation.bind(importer);

    let attempts = 0;
    await expect(retryOp(
      async () => { attempts++; throw new Error("no retry"); },
      "single shot",
      false
    )).rejects.toThrow("no retry");

    expect(attempts).toBe(1);
  });
});

describe("resolveStartDate (lastTransaction strategy)", () => {
  let getLastTransactionDateSpy: jest.SpyInstance;
  let getLastCronRunTimeSpy: jest.SpyInstance;

  beforeEach(() => {
    getLastTransactionDateSpy = jest.spyOn(ActualImporter.prototype, "getLastTransactionDate");
    getLastCronRunTimeSpy = jest.spyOn(ActualImporter.prototype, "getLastCronRunTime");
  });

  afterEach(() => {
    getLastTransactionDateSpy.mockRestore();
    getLastCronRunTimeSpy.mockRestore();
  });

  it("should use last transaction date minus buffer days", async () => {
    const lastTxDate = new Date("2026-05-28T00:00:00Z");
    getLastTransactionDateSpy.mockResolvedValue(lastTxDate);

    const importer = new ActualImporter(createTestConfig({
      startDateStrategy: "lastTransaction",
      startDateBufferDays: 7,
    }));

    const scraperConfig = {
      actualAccountType: "checking" as Account["type"],
      options: { startDate: new Date("2024-06-10"), companyId: CompanyTypes.discount },
      credentials: { id: "id", password: "pass", num: "num" },
    };

    const result = await importer.resolveStartDate(scraperConfig, "account-123");

    const expected = new Date(lastTxDate.getTime() - 1000 * 60 * 60 * 24 * 7);
    expect(result).toEqual(expected);
  });

  it("should fall back to scraper startDate when no transactions found", async () => {
    getLastTransactionDateSpy.mockResolvedValue(null);

    const scraperStartDate = new Date("2024-06-10");
    const importer = new ActualImporter(createTestConfig({
      startDateStrategy: "lastTransaction",
    }));

    const scraperConfig = {
      actualAccountType: "checking" as Account["type"],
      options: { startDate: scraperStartDate, companyId: CompanyTypes.discount },
      credentials: { id: "id", password: "pass", num: "num" },
    };

    const result = await importer.resolveStartDate(scraperConfig, "account-123");
    expect(result).toEqual(scraperStartDate);
  });

  it("should fall back to maxMonthsBack when no transactions and no scraper startDate", async () => {
    getLastTransactionDateSpy.mockResolvedValue(null);

    const importer = new ActualImporter(createTestConfig({
      startDateStrategy: "lastTransaction",
      maxMonthsBack: 6,
    }));

    const scraperConfig = {
      actualAccountType: "checking" as Account["type"],
      options: { companyId: CompanyTypes.discount } as any,
      credentials: { id: "id", password: "pass", num: "num" },
    };

    const result = await importer.resolveStartDate(scraperConfig, "account-123");

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    // Allow 1 second tolerance
    expect(Math.abs(result.getTime() - sixMonthsAgo.getTime())).toBeLessThan(1000);
  });

  it("should use default buffer of 7 days when not specified", async () => {
    const lastTxDate = new Date("2026-06-01T00:00:00Z");
    getLastTransactionDateSpy.mockResolvedValue(lastTxDate);

    const importer = new ActualImporter(createTestConfig({
      startDateStrategy: "lastTransaction",
      // no startDateBufferDays specified
    }));

    const scraperConfig = {
      actualAccountType: "checking" as Account["type"],
      options: { startDate: new Date("2024-06-10"), companyId: CompanyTypes.discount },
      credentials: { id: "id", password: "pass", num: "num" },
    };

    const result = await importer.resolveStartDate(scraperConfig, "account-123");

    const expected = new Date(lastTxDate.getTime() - 1000 * 60 * 60 * 24 * 7);
    expect(result).toEqual(expected);
  });

  it("should fall back to lastCronRunTime strategy when strategy is default", async () => {
    const lastCronRunTime = new Date("2026-05-25T00:00:00Z");
    getLastCronRunTimeSpy.mockReturnValue(lastCronRunTime);

    const importer = new ActualImporter(createTestConfig({
      // no startDateStrategy — defaults to "lastCronRunTime"
    }));

    const scraperConfig = {
      actualAccountType: "checking" as Account["type"],
      options: { startDate: new Date("2024-06-10"), companyId: CompanyTypes.discount },
      credentials: { id: "id", password: "pass", num: "num" },
    };

    const result = await importer.resolveStartDate(scraperConfig, "account-123");
    expect(result).toEqual(lastCronRunTime);
    expect(getLastTransactionDateSpy).not.toHaveBeenCalled();
  });

  it("should not query transactions when accountId is null", async () => {
    const importer = new ActualImporter(createTestConfig({
      startDateStrategy: "lastTransaction",
    }));

    const scraperStartDate = new Date("2024-06-10");
    const scraperConfig = {
      actualAccountType: "checking" as Account["type"],
      options: { startDate: scraperStartDate, companyId: CompanyTypes.discount },
      credentials: { id: "id", password: "pass", num: "num" },
    };

    const result = await importer.resolveStartDate(scraperConfig, null);
    // Falls back to lastCronRunTime strategy when no accountId
    expect(getLastTransactionDateSpy).not.toHaveBeenCalled();
  });
});

describe("Transaction Mapping", () => {
  it("should skip transactions without identifier", () => {
    const importer = new ActualImporter(createTestConfig());
    const mockApi = {
      utils: { amountToInteger: (n: number) => Math.round(n * 100) },
    };

    const transactions = [
      { identifier: "tx1", description: "Test", date: "2026-01-01", chargedAmount: -100, memo: "", status: "completed" },
      { identifier: null, description: "NoId", date: "2026-01-02", chargedAmount: -50, memo: "", status: "completed" },
      { identifier: "tx3", description: "Another", date: "2026-01-03", chargedAmount: -200, memo: "note", status: "completed" },
    ];

    const result = (importer as any).createActualTxnsFromScraperTxns("acc-1", transactions, mockApi);

    expect(result).toHaveLength(2);
    expect(result[0].imported_id).toBe("tx1");
    expect(result[1].imported_id).toBe("tx3");
  });

  it("should map amounts using amountToInteger", () => {
    const importer = new ActualImporter(createTestConfig());
    const mockApi = {
      utils: { amountToInteger: (n: number) => Math.round(n * 100) },
    };

    const transactions = [
      { identifier: "tx1", description: "Expense", date: "2026-01-01", chargedAmount: -152.50, memo: "", status: "completed" },
    ];

    const result = (importer as any).createActualTxnsFromScraperTxns("acc-1", transactions, mockApi);

    expect(result[0].amount).toBe(-15250);
  });

  it("should set cleared based on transaction status", () => {
    const importer = new ActualImporter(createTestConfig());
    const mockApi = {
      utils: { amountToInteger: (n: number) => Math.round(n * 100) },
    };

    const transactions = [
      { identifier: "tx1", description: "Done", date: "2026-01-01", chargedAmount: -100, memo: "", status: "completed" },
      { identifier: "tx2", description: "Pending", date: "2026-01-02", chargedAmount: -50, memo: "", status: "pending" },
    ];

    const result = (importer as any).createActualTxnsFromScraperTxns("acc-1", transactions, mockApi);

    expect(result[0].cleared).toBe(true);
    expect(result[1].cleared).toBe(false);
  });
});
