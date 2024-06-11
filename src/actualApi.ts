import * as actual from "@actual-app/api";
import { existsSync, mkdirSync, rmdirSync } from "fs";
import { ActualImporterConfig } from "./actualImporter";

export type ActualApi = typeof import("@actual-app/api");

let initialized = false;

export const actualApi = async ({
  actualUrl: serverURL,
  actualPassword: password,
  actualDataDir: dataDir,
}: ActualImporterConfig) => {
  if (!initialized) {
    // clear & create data directory
    if (existsSync(dataDir)) {
      rmdirSync(dataDir, { recursive: true });
    }
    mkdirSync(dataDir);

    await actual.init({
      serverURL,
      dataDir,
      password,
    });
    initialized = true;
  }

  return actual;
};
