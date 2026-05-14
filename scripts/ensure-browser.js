#!/usr/bin/env node

/**
 * Ensure Playwright browser is installed at runtime
 * This script runs before the serverless function executes
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const BROWSER_PATH = join(process.env.HOME || '/home/sbx_user1051', '.cache/ms-playwright/chromium_headless_shell-1223');

console.log('🔍 Checking for Playwright Chromium...');
console.log('Expected path:', BROWSER_PATH);

if (!existsSync(BROWSER_PATH)) {
  console.log('⚠️  Chromium not found, installing...');
  try {
    execSync('npx playwright install chromium', { stdio: 'inherit' });
    console.log('✅ Chromium installed successfully');
  } catch (error) {
    console.error('❌ Failed to install Chromium:', error);
    process.exit(1);
  }
} else {
  console.log('✅ Chromium already installed');
}
