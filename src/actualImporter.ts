import { Account } from "@actual-app/api";

import { Transaction as ActualTransaction } from "@actual-app/api";
// @ts-ignore
import * as actualInjected from "@actual-app/api/dist/injected";
import * as fs from "fs";
import { getPuppeteerConfig } from "israeli-bank-scrapers-forked";
import { Transaction as ScraperTransaction, TransactionsAccount } from "israeli-bank-scrapers-forked/lib/transactions";
import * as nodeCron from "node-cron";
import * as readline from "readline";
import { match } from "ts-pattern";
import { ActualApi, actualApi } from "./actualApi";
import { logger } from "./logger";
import { Scraper, ScraperConfig } from "./scraper";
const download = require("download-chromium");

export type ActualImporterConfig = {
  actualSyncId: string;
  actualUrl: string;
  actualPassword: string;
  actualDataDir: string;
  scrappers: { scraperConfig: ScraperConfig; actualAccountType: Account["type"] }[];
  cleanup?: boolean;
  shouldDownloadChromium?: boolean;
  chromiumInstallPath?: string;
  showLogs?: boolean;
};

export type CronConfig = {
  cronTime: "test" | "daily" | "weekly" | "monthly" | "biweekly";
  runOnStart?: boolean;
};

export class ActualImporter {
  private api: ActualApi;
  private isInitialized = false;
  private lastCronRunTimeFilePath = "./cache/lastCronRunTime";
  private chromiumPath: string;

  constructor(private config: ActualImporterConfig) {
    if (!fs.existsSync("./cache")) {
      fs.mkdirSync("./cache", { recursive: true });
    }

    if (config.showLogs != undefined && !config.showLogs) {
      logger.level = "silent";
    }
  }

  public async cron(cornConfig: CronConfig) {
    if (!this.isInitialized) {
      logger.info("Initializing Actual API");
      await this.init();
    }

    if (cornConfig.runOnStart) {
      await this.import({ shouldShutdown: false });
      this.updateLastCronRunTime();
    }

    let cronTime = match(cornConfig.cronTime)
      .with("test", () => "* * * * *")
      .with("daily", () => "0 0 * * *")
      .with("weekly", () => "0 0 * * 0")
      .with("monthly", () => "0 0 1 * *")
      .with("biweekly", () => "0 0 1,15 * *")
      .exhaustive();

    logger.info(`Starting cron job with time: ${cronTime}`);

    nodeCron.schedule(cronTime, async () => {
      this.config = this.createImportConfigForCron(cornConfig);
      await this.import({ shouldShutdown: false });
      this.updateLastCronRunTime();
    });
  }

  private updateLastCronRunTime() {
    fs.writeFileSync(this.lastCronRunTimeFilePath, new Date().toISOString(), { flag: "w" });
  }

  private getLastCronRunTime() {
    if (!fs.existsSync(this.lastCronRunTimeFilePath)) {
      return null;
    }

    // 1 day before to make sure we don't miss any transactions
    return new Date(new Date(fs.readFileSync(this.lastCronRunTimeFilePath, "utf8")).getTime() - 1000 * 60 * 60 * 24);
  }

  private createImportConfigForCron(cronConfig: CronConfig) {
    // Get last cron run time from file or set it based on cron config
    const lastCronRunTime = this.getLastCronRunTime();
    const timeBefore = match(cronConfig.cronTime)
      .with("test", () => 1000 * 60 * 60 * 24 * 60) // 60 days ago
      .with("daily", () => 1000 * 60 * 60 * 24) // 1 day ago
      .with("weekly", () => 1000 * 60 * 60 * 24 * 7) // 7 days ago
      .with("monthly", () => 1000 * 60 * 60 * 24 * 30) // 30 days ago
      .with("biweekly", () => 1000 * 60 * 60 * 24 * 15) // 15 days ago
      .exhaustive();
    const startDate = lastCronRunTime ?? new Date(Date.now() - timeBefore * 2); // 2 * timeBefore to make sure we don't miss any transactions

    return {
      ...this.config,
      scrappers: this.config.scrappers.map((s) => ({
        ...s,
        scraper: {
          options: { ...s.scraperConfig.options, startDate },
          credentials: s.scraperConfig.credentials,
        },
      })),
    };
  }

  public async import(
    { shouldShutdown }: { shouldShutdown?: boolean; config?: ActualImporterConfig } = {
      shouldShutdown: true,
      config: this.config,
    }
  ) {
    if (!this.isInitialized) {
      logger.info("Initializing Actual API");
      await this.init();
    }

    if (this.config.cleanup) {
      await this.cleanup();
    }

    for (const { scraperConfig, actualAccountType: accountType } of this.config.scrappers) {
      try {
        const scraper = new Scraper(scraperConfig, this.chromiumPath);
        const scrapeResult = await scraper.scrape();

        for (const scraperAccount of scrapeResult.accounts) {
          if (!scraperAccount.txns.length) {
            logger.warn({ account: scraperAccount.accountNumber }, `No transactions found for account`);
            continue;
          }

          const accountName = this.createAccountName(scraper.companyId, scraperAccount.accountNumber);
          let actualAccountId = await this.getActualAccountId(scraperAccount.accountNumber);

          // If account not found in Actual, create it
          if (!actualAccountId) {
            logger.warn({ accountName }, `Couldn't find account in Actual, creating a new one`);
            actualAccountId = await this.createAccount(accountName, accountType, scraperAccount);
          }

          // Add transactions to Actual
          const mappedTransactions = this.createActualTxnsFromScraperTxns(
            actualAccountId,
            scraperAccount.txns,
            this.api
          );
          logger.info({ accountName, actualAccountId, count: mappedTransactions.length }, `Importing transactions`);
          const addTxnResult = await this.api.importTransactions(actualAccountId, mappedTransactions);

          if (addTxnResult.errors) {
            logger.error(
              { accountName, actualAccountId, errors: addTxnResult.errors },
              `Got errors from Actual while importing transactions`
            );

            continue;
          }

          logger.info(
            { accountName, actualAccountId, updated: addTxnResult.updated.length, added: addTxnResult.added.length },
            `Transactions imported to Actual`
          );
        }
      } catch (err) {
        logger.error(err);
      }
    }

    logger.info(`Finished importing transactions`);

    if (shouldShutdown) {
      logger.info(`Shutting down Actual API`);
      await this.shutdown();
    }
  }

  private async createAccount(accountName: string, accountType: Account["type"], scraperAccount: TransactionsAccount) {
    const transactionsBalance = scraperAccount.txns.reduce((acc, txn) => acc + txn.chargedAmount, 0);
    const balance = scraperAccount.balance
      ? this.api.utils.amountToInteger(scraperAccount.balance - transactionsBalance)
      : 0;
    const newAccountId = await this.api.createAccount(
      {
        id: accountName,
        name: accountName,
        type: accountType,
      },
      balance
    );

    // Add external account number as a note
    await actualInjected.send("notes-save", {
      id: `account-${newAccountId}`,
      note: this.createAccountNoteString(scraperAccount.accountNumber),
    });
    logger.info({ accountName, newAccountId }, `Account created in Actual`);
    return newAccountId;
  }

  private async getActualAccountId(externalAccountNumber: string) {
    const note = await this.getAccountNote(externalAccountNumber);
    if (!note) {
      return null;
    }

    const accountId = note.id?.substring("account-".length);

    logger.info({ externalAccountNumber, accountId }, `Found account in Actual`);
    return accountId as string;
  }

  private async getAccountNote(externalAccountNumber: string) {
    const notes = await this.api.runQuery(
      this.api
        .q("notes")
        .filter({ note: { $like: `%${this.createAccountNoteString(externalAccountNumber)}%` } })
        .select("*")
    );
    return notes?.data?.[0];
  }

  private async cleanup() {
    if (!this.isInitialized) {
      throw new Error("Actual API not initialized");
    }

    // Wait for user confirmation by pressing 'y'
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const userConfirmation = await new Promise((resolve) => {
      rl.question("Are you sure you want to delete all accounts? (y/n) ", (answer) => {
        rl.close();
        resolve(answer);
      });
    });

    if (userConfirmation !== "y") {
      logger.info("Operation cancelled by user.");
      return;
    }

    const actualAccounts = await this.api.getAccounts();
    const deletePromises = [];
    for (const account of actualAccounts) {
      deletePromises.push(this.api.deleteAccount(account.id));
    }

    const deleteResult = await Promise.allSettled(deletePromises);
    logger.info(
      {
        deletedAccounts: deleteResult.filter((r) => r.status === "fulfilled").length,
        errors: deleteResult.filter((r) => r.status === "rejected").length,
      },
      `Cleanup finished`
    );
  }

  private createAccountNoteString(externalAccountNumber: string) {
    return `#externalAccountNumber:${externalAccountNumber} DO NOT DELETE`;
  }

  private createAccountName(companyId: string, accountId: string): string {
    return `${companyId}_${accountId}`;
  }

  private createActualTxnsFromScraperTxns(
    accountId: string,
    scraperTransactions: ScraperTransaction[],
    actualApi: ActualApi
  ): ActualTransaction[] {
    return scraperTransactions
      .map((t) => {
        // Skip transactions without an identifier
        if (!t.identifier) {
          return null;
        }

        return {
          imported_id: t.identifier,
          payee_name: t.description,
          account: accountId,
          date: new Date(t.date),
          amount: actualApi.utils.amountToInteger(t.chargedAmount),
          category: t.category,
          notes: t.memo,
          imported_payee: t.description,
          cleared: t.status === "completed",
        };
      })
      .filter(Boolean) as ActualTransaction[];
  }

  private async init() {
    this.api = await actualApi(this.config);
    await this.api.downloadBudget(this.config.actualSyncId);

    if (this.config.shouldDownloadChromium) {
      const puppeteerConfig = getPuppeteerConfig();
      logger.info(
        { revision: puppeteerConfig.revision, installPath: this.config.chromiumInstallPath },
        `Downloading chromium`
      );

      this.chromiumPath = await download({
        revision: puppeteerConfig.revision,
        log: true,
        installPath: this.config.chromiumInstallPath,
      });
    }

    this.isInitialized = true;
  }

  private async shutdown() {
    if (this.isInitialized) {
      await this.api.shutdown();
    }
  }
}
1;
