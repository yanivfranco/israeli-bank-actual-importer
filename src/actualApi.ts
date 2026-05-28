import * as actual from "@actual-app/api";
import { existsSync, mkdirSync, rmdirSync } from "fs";
import { ActualImporterConfig } from "./actualImporter";

export type ActualApi = typeof import("@actual-app/api");
export type ActualSend = <T = unknown>(name: string, args?: unknown) => Promise<T>;

let initialized = false;
let handleSend: ActualSend | null = null;

export const send: ActualSend = (name, args) => {
  if (!handleSend) {
    throw new Error("Actual API has not been initialized");
  }
  return handleSend(name, args);
};

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

    const handle = await actual.init({
      serverURL,
      dataDir,
      password,
    });
    handleSend = handle.send;
    initialized = true;
  }

  return actual;
};
