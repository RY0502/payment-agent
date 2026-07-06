import { chromium, Browser, Page, BrowserContext } from "playwright";
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Use /tmp for Vercel (serverless), otherwise use local screenshots directory
// Note: On Vercel, __dirname resolves to /var/task/dist, so we use /tmp directly
const SCREENSHOTS_DIR = process.env.VERCEL
  ? "/tmp/screenshots"
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
    const isVercel = process.env.VERCEL === '1';

    // Use @sparticuz/chromium on Vercel (Linux), standard Playwright locally (macOS)
    if (isVercel) {
      console.log('🚀 Using @sparticuz/chromium for Vercel (Linux)');
      const chromiumPkg = await import('@sparticuz/chromium');
      
      this.browser = await chromium.launch({
        headless: true,
        executablePath: await chromiumPkg.default.executablePath(),
        args: [
          ...chromiumPkg.default.args,
          
          // === Rendering & Security ===
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-blink-features=AutomationControlled',
          
          // === Font & Text Rendering (CRITICAL for SVG/QR) ===
          '--font-render-hinting=none',
          '--enable-font-antialiasing',
          '--force-color-profile=srgb',
          '--disable-lcd-text',
          
          // === GPU & Graphics (helps canvas/SVG) ===
          '--disable-gpu',
          '--disable-software-rasterizer',
          '--use-gl=swiftshader',
          
          // === JavaScript & DOM ===
          '--enable-features=NetworkService,NetworkServiceInProcess',
          '--disable-features=VizDisplayCompositor',
          
          // === Performance & Memory ===
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-dev-shm-usage',
          
          // === Compatibility ===
          '--disable-extensions',
          '--disable-component-extensions-with-background-pages',
          '--disable-default-apps',
          '--mute-audio',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
        ],
      });
    } else {
      console.log('🚀 Using standard Playwright for local development');
      this.browser = await chromium.launch({
        headless: isProduction,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
        ],
      });
    }

    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      
      // Enhanced compatibility options
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      locale: 'en-IN',
      timezoneId: 'Asia/Kolkata',
      permissions: [],
      colorScheme: 'light',
      reducedMotion: 'reduce',
      
      // Add extra headers to look more like a real browser
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Cache-Control': 'max-age=0',
      },
    });

    this.page = await this.context.newPage();
    
    // Intercept requests to inject Origin header for cross-origin XHRs
    // This fixes CORS issues with payment gateways like BillDesk that validate Origin
    await this.context.route('**/*', async (route) => {
      const request = route.request();
      const headers = { ...request.headers() };
      
      // For XHRs/fetches to different origins, ensure Origin header is set
      if (request.resourceType() === 'xhr' || request.resourceType() === 'fetch') {
        const requestUrl = new URL(request.url());
        const pageUrl = this.page?.url();
        if (pageUrl) {
          const pageOrigin = new URL(pageUrl).origin;
          const requestOrigin = requestUrl.origin;
          
          // If cross-origin, set Origin to the page's origin (what a real browser would do)
          if (requestOrigin !== pageOrigin) {
            headers['origin'] = pageOrigin;
          }
        }
      }
      
      await route.continue({ headers });
    });
    
    // Add stealth scripts to hide automation
    await this.page.addInitScript(() => {
      // Hide webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
      
      // Add chrome property
      (window as any).chrome = {
        runtime: {},
      };
      
      // Mock plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      
      // Mock languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-IN', 'en-US', 'en'],
      });
    });
    
    // Add extra page settings for Vercel to improve rendering consistency
    if (isVercel) {
      // Disable animations that might interfere with rendering
      await this.page.addInitScript(() => {
        // Disable CSS animations and transitions
        const style = document.createElement('style');
        style.textContent = `
          *, *::before, *::after {
            animation-duration: 0s !important;
            animation-delay: 0s !important;
            transition-duration: 0s !important;
            transition-delay: 0s !important;
          }
        `;
        (document.head as HTMLElement).appendChild(style);
      });
      
      // Set extra viewport properties
      await this.page.setViewportSize({ width: 1280, height: 720 });
    }
    
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
