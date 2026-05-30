const { existsSync } = require("fs");
const { dirname, join } = require("path");
const { spawnSync } = require("child_process");

const packageRoot = join(__dirname, "..");
let dependencyDir;

try {
  dependencyDir = dirname(
    require.resolve("israeli-bank-scrapers/package.json", {
      paths: [packageRoot, process.cwd()],
    }),
  );
} catch (error) {
  console.warn("Could not find israeli-bank-scrapers to build.");
  process.exit(0);
}

const libIndex = join(dependencyDir, "lib", "index.js");
const sourceIndex = join(dependencyDir, "src", "index.ts");

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: dependencyDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
};

if (!existsSync(sourceIndex) || existsSync(libIndex)) {
  process.exit(0);
}

console.log("Building source-only israeli-bank-scrapers dependency...");
run("npm", ["install"]);
run("npm", ["run", "build:types"]);
run("npm", ["run", "build:js"]);
