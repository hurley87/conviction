#!/usr/bin/env node

import { runCli } from "../dist/cli.js";

runCli(process.argv.slice(2)).catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  console.error(`conviction-mcp: ${message}`);
  process.exitCode = 1;
});
