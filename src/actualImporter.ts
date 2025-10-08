import { Account } from "@actual-app/api";

import { Transaction as ActualTransaction } from "@actual-app/api";
// @ts-ignore
import * as actualInjected from "@actual-app/api/dist/injected";
import { CronJob, CronJobParams } from "cron";
import * as fs from "fs";
import { getPuppeteerConfig } from "israeli-bank-scrapers-forked";
import { Transaction as ScraperTransaction, TransactionsAccount } from "israeli-bank-scrapers-forked/lib/transactions";
import * as readline from "readline";
import { ActualApi, actualApi } from "./actualApi";
import { logger } from "./logger";
import { Scraper, ScraperConfig } from "./scraper";
const download = require("download-chromium");

export type OnImportSuccessArgs = {
  actualAccountId: string;
  accountName: string;
  updated: string[];
  added: string[];
  errors: string[];
  startDate: Date;
};

export type OnImportErrorArgs = {
  companyId: string;
  startDate: Date;
  error: Error | Error[];
};

export type RetryConfig = {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
};

export type ActualImporterConfig = {
  actualSyncId: string;
  actualUrl: string;
  actualPassword: string;
  actualDataDir: string;
  scrappers: ScraperConfig[];
  cleanup?: boolean;
  shouldDownloadChromium?: boolean;
  chromiumInstallPath?: string;
  showLogs?: boolean;
  retry?: RetryConfig;
  onImportError?: (result: OnImportErrorArgs) => void;
  onImportSuccess?: (result: OnImportSuccessArgs) => void;
  onImportFinish?: () => void;
  onCronStart?: () => void;
  onCronFinish?: () => void;
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

  private async cronHandler(): Promise<void> {
    try {
      if (this.config.onCronStart) {
        this.config.onCronStart();
      }

      const cronConfig = this.createImportConfigForCron();
      logger.info(`Starting cron job`);

      const isSuccessful = await this.import({ shouldShutdown: false, config: cronConfig });
      if (isSuccessful) {
        logger.info(`Finished cron job successfully`);
        this.updateLastCronRunTime();
      }

      if (this.config.onCronFinish) {
        this.config.onCronFinish();
      }
    } catch (error) {
      logger.error("Error in cron job:", error);
    }
  }

  public async cron(cronExpression: string | Date, cronParams?: Partial<CronJobParams>): Promise<CronJob> {
    if (!this.isInitialized) {
      logger.info("Initializing Actual API");
      await this.init();
    }

    logger.info(`Starting cron job, cron expression: ${cronExpression}`);

    const job = new CronJob(cronExpression, () => this.cronHandler(), null, true, cronParams?.timeZone);

    if (cronParams?.runOnInit) {
      await this.cronHandler();
    }

    return job;
  }

  private updateLastCronRunTime() {
    fs.writeFileSync(this.lastCronRunTimeFilePath, new Date().toISOString(), { flag: "w" });
  }

  getLastCronRunTime() {
    if (!fs.existsSync(this.lastCronRunTimeFilePath)) {
      logger.info(`Couldn't find last cron run time file`);
      return null;
    }

    // 3 day before to make sure we don't miss any transactions
    return new Date(
      new Date(fs.readFileSync(this.lastCronRunTimeFilePath, "utf8")).getTime() - 1000 * 60 * 60 * 24 * 3
    );
  }

  public createImportConfigForCron(): ActualImporterConfig {
    // Get last cron run time from file or set it based on cron config
    const lastCronRunTime = this.getLastCronRunTime();

    return {
      ...this.config,
      scrappers: this.config.scrappers.map<ScraperConfig>((s) => ({
        ...s,
        options: {
          ...s.options,
          startDate:
            lastCronRunTime && (!s.options.startDate || lastCronRunTime > s.options.startDate)
              ? lastCronRunTime
              : s.options.startDate,
        },
      })),
    };
  }

  public getApi() {
    return this.api;
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getRetryDelay(attempt: number, retryConfig: RetryConfig): number {
    const delay = Math.min(retryConfig.initialDelay * Math.pow(2, attempt), retryConfig.maxDelay);
    return delay;
  }

  private async retryOperation<T>(
    operation: () => Promise<T>,
    context: string,
    customRetry?: RetryConfig | false
  ): Promise<T> {
    // If retry is explicitly disabled (false), run operation once
    if (customRetry === false) {
      return await operation();
    }

    // Use custom retry config, or fall back to global config
    const retryConfig = customRetry ?? this.config.retry ?? { maxRetries: 1, initialDelay: 1000, maxDelay: 10000 };
    const errors: Error[] = [];

    for (let attempt = 0; attempt < retryConfig.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        errors.push(error as Error);
        if (attempt < retryConfig.maxRetries - 1) {
          const delay = this.getRetryDelay(attempt, retryConfig);
          logger.warn(
            { attempt: attempt + 1, maxRetries: retryConfig.maxRetries, delay, context, error: error?.message },
            `Operation failed, retrying...`
          );
          await this.delay(delay);
        }
      }
    }

    // If we get here, all retries failed. Wrap all errors in a single error
    const finalError = new Error(`All ${retryConfig.maxRetries} attempts failed for ${context}`);
    (finalError as any).errors = errors;
    throw finalError;
  }

  private async importAccountTransactions(
    actualAccountId: string,
    accountName: string,
    transactions: ScraperTransaction[],
    startDate: Date
  ): Promise<void> {
    const mappedTransactions = this.createActualTxnsFromScraperTxns(actualAccountId, transactions, this.api);
    const txs = await this.api.getTransactions(actualAccountId, "2025-09-15", "2025-10-15");

    logger.info({ accountName, actualAccountId, count: mappedTransactions.length }, `Importing transactions`);

    const addTxnResult = await this.api.importTransactions(actualAccountId, mappedTransactions);

    if (addTxnResult.errors?.length) {
      logger.error(
        { accountName, actualAccountId, errors: addTxnResult.errors },
        `Got errors from Actual while importing transactions`
      );
      return;
    }

    logger.info(
      { accountName, actualAccountId, updated: addTxnResult.updated.length, added: addTxnResult.added.length },
      `Transactions imported to Actual`
    );

    if (this.config.onImportSuccess) {
      this.config.onImportSuccess({
        actualAccountId,
        accountName,
        updated: addTxnResult.updated,
        added: addTxnResult.added,
        errors: addTxnResult.errors,
        startDate,
      });
    }
  }

  private async processScraper(scraperConfig: ScraperConfig): Promise<void> {
    const scraper = new Scraper(scraperConfig, this.chromiumPath);
    const retryConfig = scraperConfig.retry;

    const scrapeResult = await this.retryOperation(
      () => scraper.scrape(),
      `Scraping ${scraperConfig.options.companyId}`,
      retryConfig
    );

    for (const scraperAccount of scrapeResult.accounts) {
      if (!scraperAccount.txns.length) {
        logger.warn({ account: scraperAccount.accountNumber }, `No transactions found for account`);
        continue;
      }

      const accountName = this.createAccountName(scraper.companyId, scraperAccount.accountNumber);
      let actualAccountId = await this.getActualAccountId(scraperAccount.accountNumber);

      if (!actualAccountId) {
        logger.warn({ accountName }, `Couldn't find account in Actual, creating a new one`);
        actualAccountId = await this.retryOperation(
          () => this.createAccount(accountName, scraperConfig.actualAccountType, scraperAccount),
          `Creating account ${accountName}`,
          retryConfig
        );
      }

      await this.retryOperation(
        () =>
          this.importAccountTransactions(
            actualAccountId,
            accountName,
            scraperAccount.txns,
            scraperConfig.options.startDate
          ),
        `Importing transactions for ${accountName}`,
        retryConfig
      );
    }
  }

  public async import(
    { shouldShutdown, config }: { shouldShutdown?: boolean; config?: ActualImporterConfig } = {
      shouldShutdown: true,
      config: this.config,
    }
  ): Promise<boolean> {
    let isSuccessful = true;
    if (!this.isInitialized) {
      logger.info("Initializing Actual API");
      await this.init();
    }

    const importConfig = config || this.config;

    if (importConfig.cleanup) {
      await this.cleanup();
    }

    for (const scraperConfig of importConfig.scrappers) {
      try {
        await this.processScraper(scraperConfig);
      } catch (err) {
        if (this.config.onImportError) {
          const error = err as Error;
          const allErrors = (error as any).errors ?? [error];
          this.config.onImportError({
            companyId: scraperConfig.options.companyId,
            startDate: scraperConfig.options.startDate,
            error: allErrors,
          });
        }
        logger.error(err);
        isSuccessful = false;
      }
    }

    logger.info(`Finished importing transactions`);

    if (this.config.onImportFinish) {
      this.config.onImportFinish();
    }

    if (shouldShutdown) {
      logger.info(`Shutting down Actual API`);
      await this.shutdown();
    }

    return isSuccessful;
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
        // Skip transactions that are not completed or don't have an identifier
        if (!t.identifier) {
          logger.warn({ txn: t }, `Skipping transaction without identifier`);
          return null;
        }

        return {
          imported_id: `${t.identifier}`,
          payee_name: t.description,
          account: accountId,
          date: new Date(t.date),
          amount: actualApi.utils.amountToInteger(t.chargedAmount),
          notes: t.memo,
          imported_payee: t.description,
          cleared: t.status === "completed",
        };
      })
      .filter(Boolean) as ActualTransaction[];
  }

  public async init() {
    this.api = await actualApi(this.config);
    await this.api.downloadBudget(this.config.actualSyncId);

    if (this.config.shouldDownloadChromium) {
      const puppeteerConfig = getPuppeteerConfig();
      logger.info(
        { revision: puppeteerConfig.chromiumRevision, installPath: this.config.chromiumInstallPath },
        `Downloading chromium`
      );

      this.chromiumPath = await download({
        revision: puppeteerConfig.chromiumRevision,
        log: true,
        installPath: this.config.chromiumInstallPath,
      });
    }

    this.isInitialized = true;
  }

  public async shutdown() {
    if (this.isInitialized) {
      await this.api.shutdown();
    }
  }
}
