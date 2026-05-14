import { chromium, Browser, Page, BrowserContext } from "playwright";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use /tmp for Vercel (serverless), otherwise use local screenshots directory
const SCREENSHOTS_DIR = process.env.VERCEL
  ? path.join("/tmp", "screenshots")
  : path.join(__dirname, "../screenshots");

export class BrowserManager {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private screenshotCounter: number = 0;
  private sessionId: string = Date.now().toString();
  private lastDialog: any = null;
  private lastScreenshotPath: string = '';

  async initialize(): Promise<void> {
    // Create screenshots directory if it doesn't exist
    await fs.mkdir(SCREENSHOTS_DIR, { recursive: true });

    // Check if running in production/server environment
    const isProduction = process.env.NODE_ENV === 'production' || process.env.HEADLESS === 'true';

    // Use @sparticuz/chromium for both local and Vercel
    console.log('🚀 Using @sparticuz/chromium for browser automation');
    const chromiumPkg = await import('@sparticuz/chromium');
    
    this.browser = await chromium.launch({
      headless: isProduction,
      executablePath: await chromiumPkg.default.executablePath(),
      args: chromiumPkg.default.args,
    });

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    this.page = await this.context.newPage();
    
    // Handle dialogs/popups - don't auto-dismiss them
    this.page.on('dialog', async (dialog) => {
      console.log(`Dialog detected: ${dialog.type()} - "${dialog.message()}"`);
      // Don't auto-dismiss - let the agent decide what to do
      // Store dialog for later handling
      this.lastDialog = dialog;
    });
  }

  async navigate(url: string): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized");
    try {
      await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await this.page.waitForTimeout(3000);
    } catch (error) {
      await this.page.goto(url, { waitUntil: "load", timeout: 60000 });
      await this.page.waitForTimeout(3000);
    }
  }

  async captureScreenshot(): Promise<string> {
    if (!this.page) throw new Error("Browser not initialized");
    
    // Generate short unique filename to avoid ENAMETOOLONG error
    const filename = `ss_${this.screenshotCounter++}.png`;
    const filepath = path.join(SCREENSHOTS_DIR, filename);
    
    // Save screenshot to disk
    await this.page.screenshot({
      type: "png",
      fullPage: false,
      path: filepath,
    });
    
    // Store filepath for email service
    this.lastScreenshotPath = filepath;
    
    // Read file and convert to base64 for vision API
    const buffer = await fs.readFile(filepath);
    return buffer.toString("base64");
  }

  getLastScreenshotPath(): string {
    return this.lastScreenshotPath;
  }

  async getAccessibilityTree(): Promise<string> {
    if (!this.page) throw new Error("Browser not initialized");
    const tree = await this.page.evaluate(() => {
      const getAriaTree = (element: Element): any => {
        const role = element.getAttribute("role") || element.tagName.toLowerCase();
        const ariaLabel = element.getAttribute("aria-label") || "";
        const placeholder = element.getAttribute("placeholder") || "";
        const nameAttr = element.getAttribute("name") || "";
        const idAttr = element.getAttribute("id") || "";
        const text = element.textContent?.trim().substring(0, 50) || "";
        
        return {
          role,
          label: ariaLabel || placeholder || nameAttr || idAttr,
          text,
          tag: element.tagName.toLowerCase(),
          name: nameAttr,
          id: idAttr,
          placeholder,
        };
      };
      
      const elements = Array.from(document.querySelectorAll("input, button, select, textarea, a, [role]"));
      return elements.map(getAriaTree);
    });
    return JSON.stringify(tree, null, 2);
  }

  async getCurrentUrl(): Promise<string> {
    if (!this.page) throw new Error("Browser not initialized");
    return this.page.url();
  }

  async clickElement(selector: string): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized");
    await this.page.click(selector, { timeout: 5000 });
    await this.page.waitForTimeout(1000);
  }

  async clickByCoordinates(x: number, y: number): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized");
    await this.page.mouse.click(x, y);
    await this.page.waitForTimeout(1000);
  }

  async fillInput(selector: string, value: string): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized");
    await this.page.fill(selector, value, { timeout: 5000 });
    await this.page.waitForTimeout(500);
  }

  async typeText(selector: string, text: string): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized");
    await this.page.click(selector);
    await this.page.keyboard.type(text, { delay: 100 });
    await this.page.waitForTimeout(500);
  }

  async selectOption(selector: string, value: string): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized");
    await this.page.selectOption(selector, value, { timeout: 5000 });
    await this.page.waitForTimeout(500);
  }

  async pressKey(key: string): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized");
    await this.page.keyboard.press(key);
    await this.page.waitForTimeout(500);
  }

  async waitForNavigation(): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized");
    try {
      await this.page.waitForLoadState("domcontentloaded", { timeout: 10000 });
    } catch (error) {
      // Page might not navigate, that's okay
    }
    await this.page.waitForTimeout(2000);
  }

  async getPageText(): Promise<string> {
    if (!this.page) throw new Error("Browser not initialized");
    return await this.page.textContent("body") || "";
  }

  async findElementByText(text: string): Promise<string | null> {
    if (!this.page) throw new Error("Browser not initialized");
    try {
      const element = await this.page.locator(`text=${text}`).first();
      const boundingBox = await element.boundingBox();
      if (boundingBox) {
        return JSON.stringify(boundingBox);
      }
    } catch (error) {
      return null;
    }
    return null;
  }

  async evaluateScript(script: string): Promise<any> {
    if (!this.page) throw new Error("Browser not initialized");
    return await this.page.evaluate(script);
  }


  async cleanupScreenshots(): Promise<void> {
    try {
      // Remove all screenshots for this session
      const files = await fs.readdir(SCREENSHOTS_DIR);
      const sessionFiles = files.filter(f => f.startsWith(`screenshot_${this.sessionId}_`));
      
      await Promise.all(
        sessionFiles.map(f => fs.unlink(path.join(SCREENSHOTS_DIR, f)).catch(() => {}))
      );
      
      console.log(`Cleaned up ${sessionFiles.length} screenshot(s)`);
    } catch (error) {
      console.error("Error cleaning up screenshots:", error);
    }
  }

  hasDialog(): boolean {
    return this.lastDialog !== null;
  }

  async acceptDialog(promptText?: string): Promise<void> {
    if (this.lastDialog) {
      console.log(`Accepting dialog: ${this.lastDialog.type()}`);
      await this.lastDialog.accept(promptText);
      this.lastDialog = null;
    }
  }

  async dismissDialog(): Promise<void> {
    if (this.lastDialog) {
      console.log(`Dismissing dialog: ${this.lastDialog.type()}`);
      await this.lastDialog.dismiss();
      this.lastDialog = null;
    }
  }

  getDialogMessage(): string | null {
    return this.lastDialog ? this.lastDialog.message() : null;
  }

  async close(): Promise<void> {
    // Clean up screenshots before closing browser
    await this.cleanupScreenshots();
    
    if (this.page) await this.page.close();
    if (this.context) await this.context.close();
    if (this.browser) await this.browser.close();
  }

  getPage(): Page | null {
    return this.page;
  }
}
