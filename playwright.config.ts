import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, defineConfig } from '@playwright/test';

function resolveChromiumExecutable(): string | undefined {
  const defaultPath = chromium.executablePath();
  if (fs.existsSync(defaultPath)) {
    return defaultPath;
  }
  const cacheDir = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright');
  if (fs.existsSync(cacheDir)) {
    const entries = fs.readdirSync(cacheDir).filter((d) => d.startsWith('chromium-')).sort().reverse();
    for (const entry of entries) {
      const candidate = path.join(cacheDir, entry, 'chrome-win64', 'chrome.exe');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

const executablePath = resolveChromiumExecutable();

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true,
    acceptDownloads: true,
    viewport: { width: 1440, height: 900 },
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
