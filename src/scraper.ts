import { existsSync, readFileSync, writeFileSync } from "fs";
import { ScraperCredentials, ScraperOptions, ScraperScrapingResult, createScraper } from "israeli-bank-scrapers-forked";
import { logger } from "./logger";

export interface ScraperConfig {
  options: ScraperOptions;
  credentials: ScraperCredentials;
  shouldUseCache?: boolean;
}

export class Scraper {
  constructor(private config: ScraperConfig, private chromeExecutablePath?: string) {}

  private filePath: string = `./cache/${this.config.options.companyId}-${this.config.options.startDate.getFullYear()}-${
    this.config.options.startDate.getMonth() + 1
  }.json`;

  public async scrape(): Promise<ScraperScrapingResult> {
    if (existsSync(this.filePath) && this.config.shouldUseCache) {
      this.log(`Found cache file`, { company: this.companyId, startDate: this.config.options.startDate });

      return JSON.parse(readFileSync(this.filePath, "utf8"));
    }

    this.log(`Scraping transactions for company '${this.config.options.companyId}'`);
    const scraper = createScraper({
      ...this.config.options,
      executablePath: this.chromeExecutablePath,
    });
    const scrapeResult = await scraper.scrape(this.config.credentials);

    if (scrapeResult.success) {
      if (this.config.shouldUseCache) {
        // save result to file
        writeFileSync(this.filePath, JSON.stringify(scrapeResult, null, 2), { flag: "w" });
      }

      return scrapeResult;
    } else {
      throw new Error(`${scrapeResult.errorType}: ${scrapeResult.errorMessage}`);
    }
  }

  private log(message: string, obj?: any) {
    logger.info(obj, `${this.config.options.companyId.toLocaleUpperCase()}: ${message}`);
  }

  get companyId(): string {
    return this.config.options.companyId;
  }

  get options(): ScraperOptions {
    return this.config.options;
  }

  get credentials(): ScraperCredentials {
    return this.config.credentials;
  }
}
