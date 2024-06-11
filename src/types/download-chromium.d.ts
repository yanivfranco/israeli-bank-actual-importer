declare module "download-chromium" {
  export default function downloadChromium({
    platform,
    revision,
    log,
    installPath,
    onProgress,
  }: {
    platform?: "linux" | "win32" | "mac" | "win64" | "";
    revision?: string;
    log?: boolean;
    installPath?: string;
    onProgress?: any;
  }): Promise<string>;
}
