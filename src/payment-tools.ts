import { tool } from "langchain";
import { z } from "zod";
import { BrowserManager } from "./browser.js";
import { VisionAnalyzer } from "./vision.js";

export function createPaymentTools(
  browser: BrowserManager,
  vision: VisionAnalyzer,
  paymentData?: any
) {
  const navigateToWebsite = tool(
    async ({ url }) => {
      try {
        await browser.navigate(url);
        const currentUrl = await browser.getCurrentUrl();
        return `Successfully navigated to ${currentUrl}`;
      } catch (error) {
        return `Failed to navigate: ${error}`;
      }
    },
    {
      name: "navigate_to_website",
      description: "Navigate to URL",
      schema: z.object({
        url: z.string().describe("URL to visit"),
      }),
    }
  );

  const analyzeCurrentPage = tool(
    async ({ paymentData, currentStep }) => {
      try {
        const screenshot = await browser.captureScreenshot();
        const currentUrl = await browser.getCurrentUrl();
        const pageText = await browser.getPageText();

        // Use dedicated CAPTCHA detection for better accuracy
        console.log('Checking for CAPTCHA presence...');
        const hasCaptcha = await vision.detectCaptcha(screenshot);
        console.log(`CAPTCHA detected: ${hasCaptcha}`);

        const analysis = await vision.analyzePaymentPage(
          screenshot,
          paymentData,
          currentStep
        );

        // Override hasCaptcha with dedicated detection result
        analysis.hasCaptcha = hasCaptcha;

        console.log(`Page analysis complete. hasCaptcha: ${hasCaptcha}`);

        return JSON.stringify({
          url: currentUrl,
          pageText: pageText.substring(0, 500),
          analysis,
          hasCaptcha,
        }, null, 2);
      } catch (error) {
        return `Failed to analyze page: ${error}`;
      }
    },
    {
      name: "analyze_current_page",
      description: "Analyze page with vision AI",
      schema: z.object({
        paymentData: z.any().describe("Payment data"),
        currentStep: z.string().describe("Current step"),
      }),
    }
  );

  const fillFormField = tool(
    async ({ fieldDescription, value }) => {
      try {
        const page = browser.getPage();
        if (!page) {
          return `Failed to fill field: Browser page not available`;
        }

        console.log(`🔍 Looking for field: "${fieldDescription}" to fill with value: "${value}"`);

        // Strategy 1: Try exact placeholder match first (most reliable)
        try {
          await page.getByPlaceholder(fieldDescription, { exact: false }).fill(value, { timeout: 3000 });
          console.log(`✅ Filled "${fieldDescription}" = "${value}" using placeholder`);
          return `Successfully filled "${fieldDescription}" using exact placeholder`;
        } catch (e1) {
          console.log(`❌ Strategy 1 (placeholder) failed`);
          // Continue to next strategy
        }

        // Strategy 2: Try by placeholder with partial match
        try {
          const keywords = fieldDescription.toLowerCase().split(' ');
          const regexPattern = keywords.join('.*');
          await page.getByPlaceholder(new RegExp(regexPattern, 'i')).fill(value, { timeout: 3000 });
          console.log(`✅ Filled "${fieldDescription}" = "${value}" using placeholder regex`);
          return `Successfully filled "${fieldDescription}" using placeholder regex`;
        } catch (e2) {
          console.log(`❌ Strategy 2 (placeholder regex) failed`);
          // Continue to next strategy
        }

        // Strategy 3: Try by label with partial match
        try {
          const keywords = fieldDescription.toLowerCase().split(' ');
          const regexPattern = keywords.join('.*');
          await page.getByLabel(new RegExp(regexPattern, 'i')).fill(value, { timeout: 3000 });
          console.log(`✅ Filled "${fieldDescription}" = "${value}" using label`);
          return `Successfully filled "${fieldDescription}" using label`;
        } catch (e3) {
          console.log(`❌ Strategy 3 (label) failed`);
          // Continue to next strategy
        }

        // Strategy 3: Try by role with name
        try {
          await page.getByRole('textbox', { name: new RegExp(fieldDescription, 'i') }).fill(value, { timeout: 3000 });
          return `Successfully filled "${fieldDescription}" using role`;
        } catch (e3) {
          // Continue to next strategy
        }

        // Strategy 4: Try text locator for associated label
        try {
          const labelLocator = page.locator(`text=${fieldDescription}`);
          const inputLocator = labelLocator.locator('..').locator('input, textarea').first();
          await inputLocator.fill(value, { timeout: 3000 });
          return `Successfully filled "${fieldDescription}" using text locator`;
        } catch (e4) {
          // Continue to next strategy
        }

        // Strategy 5: Try finding input near text
        try {
          await page.locator(`input:near(:text("${fieldDescription}"))`).first().fill(value, { timeout: 3000 });
          return `Successfully filled "${fieldDescription}" using proximity locator`;
        } catch (e5) {
          // Continue to next strategy
        }

        // Strategy 6: Try by name attribute (case-insensitive partial match)
        try {
          const keywords = fieldDescription.toLowerCase().split(' ');
          for (const keyword of keywords) {
            try {
              await page.locator(`input[name*="${keyword}" i], textarea[name*="${keyword}" i]`).first().fill(value, { timeout: 2000 });
              return `Successfully filled "${fieldDescription}" using name attribute`;
            } catch {
              continue;
            }
          }
        } catch (e6) {
          // Continue to next strategy
        }

        // Strategy 7: Try by id attribute (case-insensitive partial match)
        try {
          const keywords = fieldDescription.toLowerCase().split(' ');
          for (const keyword of keywords) {
            try {
              await page.locator(`input[id*="${keyword}" i], textarea[id*="${keyword}" i]`).first().fill(value, { timeout: 2000 });
              return `Successfully filled "${fieldDescription}" using id attribute`;
            } catch {
              continue;
            }
          }
        } catch (e7) {
          // Continue to next strategy
        }

        // Strategy 8: Try direct CSS selector for visible text inputs
        try {
          const inputs = await page.locator('input[type="text"]:visible, input:not([type]):visible, textarea:visible').all();
          for (const input of inputs) {
            const placeholder = await input.getAttribute('placeholder');
            const label = await input.getAttribute('aria-label');
            const title = await input.getAttribute('title');
            
            if (placeholder?.toLowerCase().includes(fieldDescription.toLowerCase()) ||
                label?.toLowerCase().includes(fieldDescription.toLowerCase()) ||
                title?.toLowerCase().includes(fieldDescription.toLowerCase())) {
              await input.fill(value);
              return `Successfully filled "${fieldDescription}" using direct selector match`;
            }
          }
        } catch (e8) {
          // All strategies failed
        }

        return `Could not find field matching: ${fieldDescription}`;
      } catch (error) {
        return `Failed to fill field: ${error}`;
      }
    },
    {
      name: "fill_form_field",
      description: "Fill form field",
      schema: z.object({
        fieldDescription: z.string().describe("Field name"),
        value: z.string().describe("Value to fill"),
      }),
    }
  );

  const clickButton = tool(
    async ({ buttonDescription }) => {
      try {
        const page = browser.getPage();
        if (!page) {
          return `Failed to click button: Browser page not available`;
        }

        // Strategy 1: Try by role with regex name (partial match)
        try {
          const keywords = buttonDescription.toLowerCase().split(' ');
          const regexPattern = keywords.join('.*');
          console.log(`🔍 Strategy 1: Looking for button with pattern: ${regexPattern}`);
          const buttonLocator = page.getByRole('button', { name: new RegExp(regexPattern, 'i') });
          const count = await buttonLocator.count();
          console.log(`Found ${count} button(s) matching pattern`);
          
          if (count > 0) {
            // If multiple matches, click the first visible one
            await buttonLocator.first().click({ timeout: 3000 });
            console.log(`✅ Clicked button matching "${buttonDescription}" using role locator`);
            try {
              await browser.waitForNavigation();
              // Wait additional time for dynamic content to load
              await page.waitForTimeout(2000);
            } catch (navError) {
              // Navigation wait failed, but click succeeded - still wait for dynamic content
              await page.waitForTimeout(2000);
            }
            return `Successfully clicked "${buttonDescription}" button`;
          }
        } catch (e1) {
          console.log(`❌ Strategy 1 failed: ${e1}`);
          // Continue to next strategy
        }

        // Strategy 1b: Try with text locator
        try {
          console.log(`🔍 Strategy 1b: Looking for button with text: ${buttonDescription}`);
          const textLocator = page.locator(`text=${buttonDescription}`);
          const count = await textLocator.count();
          console.log(`Found ${count} element(s) with text`);
          
          if (count > 0) {
            await textLocator.first().click({ timeout: 3000 });
            console.log(`✅ Clicked button matching "${buttonDescription}" using text locator`);
            try {
              await browser.waitForNavigation();
            } catch (navError) {
              // Navigation wait failed, but click succeeded
            }
            return `Successfully clicked "${buttonDescription}" using text locator`;
          }
        } catch (e1b) {
          console.log(`❌ Strategy 1b failed: ${e1b}`);
          // Continue to next strategy
        }

        // Strategy 1c: Try finding any clickable element with text (generic approach for divs, buttons, spans, etc.)
        try {
          console.log(`🔍 Strategy 1c: Looking for any clickable element with text: ${buttonDescription}`);
          // Look for any element that contains the text (case-insensitive)
          const clickableLocator = page.locator(`text=/${buttonDescription}/i`).first();
          const count = await clickableLocator.count();
          console.log(`Found ${count} element(s) with text`);
          
          if (count > 0) {
            // Find the outermost clickable parent (could be button, div, a, span, etc.)
            const element = clickableLocator.first();
            // Try to find parent with click handler or cursor pointer
            const clickableParent = await element.evaluateHandle((el) => {
              let current = el;
              // Walk up the DOM tree to find a clickable parent
              while (current && current !== document.body) {
                const style = window.getComputedStyle(current);
                const hasClickHandler = current.onclick !== null;
                const isClickable = style.cursor === 'pointer' || hasClickHandler;
                const isButton = current.tagName === 'BUTTON' || current.tagName === 'A';
                
                // Prefer buttons/links, or elements with click indicators
                if (isButton || isClickable) {
                  return current;
                }
                current = current.parentElement as HTMLElement;
              }
              return el; // Return original element if no clickable parent found
            });
            
            await clickableParent.asElement()?.click({ timeout: 3000 });
            console.log(`✅ Clicked element matching "${buttonDescription}"`);
            try {
              await browser.waitForNavigation();
            } catch (navError) {
              // Navigation wait failed, but click succeeded
            }
            return `Successfully clicked "${buttonDescription}" using generic clickable element`;
          }
        } catch (e1c) {
          console.log(`❌ Strategy 1c failed: ${e1c}`);
          // Continue to next strategy
        }

        // Strategy 2: Try finding exact match from accessibility tree
        try {
          const tree = JSON.parse(await browser.getAccessibilityTree());
          const matchingButton = tree.find((el: any) => 
            (el.tag === 'button' || el.role === 'button') &&
            (el.label?.toLowerCase().includes(buttonDescription.toLowerCase()) ||
             el.text?.toLowerCase().includes(buttonDescription.toLowerCase()))
          );

          if (matchingButton) {
            if (matchingButton.text) {
              await page.getByRole('button', { name: matchingButton.text }).click();
              try {
                await browser.waitForNavigation();
              } catch (navError) {
                // Navigation wait failed, but click succeeded
              }
              return `Successfully clicked "${buttonDescription}" using exact text: ${matchingButton.text}`;
            }
            if (matchingButton.label) {
              await page.getByRole('button', { name: matchingButton.label }).click();
              try {
                await browser.waitForNavigation();
              } catch (navError) {
                // Navigation wait failed, but click succeeded
              }
              return `Successfully clicked "${buttonDescription}" using exact label: ${matchingButton.label}`;
            }
          }
        } catch (treeError) {
          // Accessibility tree failed, continue to next strategy
        }

        // Strategy 3: Try as link
        try {
          await page.getByRole('link', { name: new RegExp(buttonDescription, 'i') }).click({ timeout: 3000 });
          try {
            await browser.waitForNavigation();
          } catch (navError) {
            // Navigation wait failed, but click succeeded
          }
          return `Successfully clicked "${buttonDescription}" link`;
        } catch (e3) {
          // Continue to next strategy
        }

        // Strategy 4: Try finding button/link by class name or data attributes (for icon-only elements)
        // This handles cases like <a class="bdi-upi"> or <button data-value="UPI">
        try {
          const keywords = buttonDescription.toLowerCase().replace(/\s+/g, '');
          const keywordsWithHyphens = buttonDescription.toLowerCase().replace(/\s+/g, '-');
          
          // Try finding by class containing keyword
          const byClassLocator = page.locator(
            `button[class*="${keywords}" i], ` +
            `a[class*="${keywords}" i], ` +
            `button[class*="${keywordsWithHyphens}" i], ` +
            `a[class*="${keywordsWithHyphens}" i]`
          );
          const byClassCount = await byClassLocator.count();
          
          if (byClassCount > 0) {
            await byClassLocator.first().click({ timeout: 3000 });
            try {
              await browser.waitForNavigation();
            } catch (navError) {
              // Navigation wait failed, but click succeeded
            }
            return `Successfully clicked "${buttonDescription}" using class name match`;
          }
          
          // Try finding by data-value or other data attributes
          const byDataLocator = page.locator(
            `button[data-value*="${buttonDescription}" i], ` +
            `a[data-value*="${buttonDescription}" i], ` +
            `button[data-name*="${buttonDescription}" i], ` +
            `a[data-name*="${buttonDescription}" i]`
          );
          const byDataCount = await byDataLocator.count();
          
          if (byDataCount > 0) {
            await byDataLocator.first().click({ timeout: 3000 });
            try {
              await browser.waitForNavigation();
            } catch (navError) {
              // Navigation wait failed, but click succeeded
            }
            return `Successfully clicked "${buttonDescription}" using data attribute match`;
          }
        } catch (e4) {
          // Continue to next strategy
        }

        // Strategy 5: Try finding by title or aria-label attribute
        try {
          const titleLocator = page.locator(
            `button[title*="${buttonDescription}" i], ` +
            `a[title*="${buttonDescription}" i], ` +
            `button[aria-label*="${buttonDescription}" i], ` +
            `a[aria-label*="${buttonDescription}" i]`
          );
          const titleCount = await titleLocator.count();
          
          if (titleCount > 0) {
            await titleLocator.first().click({ timeout: 3000 });
            try {
              await browser.waitForNavigation();
            } catch (navError) {
              // Navigation wait failed, but click succeeded
            }
            return `Successfully clicked "${buttonDescription}" using title/aria-label match`;
          }
        } catch (e5) {
          // All strategies failed
        }

        return `Could not find button matching: ${buttonDescription}`;
      } catch (error) {
        return `Failed to click button: ${error}`;
      }
    },
    {
      name: "click_button",
      description: "Click button",
      schema: z.object({
        buttonDescription: z.string().describe("Button text"),
      }),
    }
  );

  const selectDropdownOption = tool(
    async ({ dropdownDescription, optionValue }) => {
      try {
        const screenshot = await browser.captureScreenshot();
        const accessibilityTree = await browser.getAccessibilityTree();

        const selector = await vision.findElementByIntent(
          screenshot,
          accessibilityTree,
          `dropdown: ${dropdownDescription}`
        );

        if (!selector) {
          return `Could not find dropdown matching: ${dropdownDescription}`;
        }

        await browser.selectOption(selector, optionValue);
        return `Successfully selected "${optionValue}" in "${dropdownDescription}" dropdown`;
      } catch (error) {
        return `Failed to select dropdown option: ${error}`;
      }
    },
    {
      name: "select_dropdown_option",
      description: "Select dropdown option",
      schema: z.object({
        dropdownDescription: z.string().describe("Dropdown name"),
        optionValue: z.string().describe("Option to select"),
      }),
    }
  );

  const checkPaymentSuccess = tool(
    async () => {
      try {
        const screenshot = await browser.captureScreenshot();
        const pageText = await browser.getPageText();
        const currentUrl = await browser.getCurrentUrl();

        const isSuccess = await vision.detectPaymentSuccess(screenshot, pageText);

        if (isSuccess) {
          const confirmationText = pageText.substring(0, 500);
          return JSON.stringify({
            success: true,
            url: currentUrl,
            confirmationText,
          });
        }

        return JSON.stringify({
          success: false,
          url: currentUrl,
        });
      } catch (error) {
        return `Failed to check payment success: ${error}`;
      }
    },
    {
      name: "check_payment_success",
      description: "Check if payment succeeded",
      schema: z.object({}),
    }
  );

  const getCurrentPageInfo = tool(
    async () => {
      try {
        const currentUrl = await browser.getCurrentUrl();
        const pageText = await browser.getPageText();
        return JSON.stringify({
          url: currentUrl,
          textPreview: pageText.substring(0, 300),
        });
      } catch (error) {
        return `Failed to get page info: ${error}`;
      }
    },
    {
      name: "get_current_page_info",
      description: "Get current page URL and text",
      schema: z.object({}),
    }
  );

  const listClickableElements = tool(
    async () => {
      try {
        const page = browser.getPage();
        if (!page) {
          return `Failed to list elements: Browser page not available`;
        }

        // Get all buttons and links using Playwright locators
        const buttons = await page.locator('button, [role="button"], input[type="submit"], input[type="button"]').all();
        const links = await page.locator('a').all();

        const buttonTexts = await Promise.all(
          buttons.map(async (btn, i) => {
            try {
              const text = await btn.textContent();
              const value = await btn.getAttribute('value');
              return `${i + 1}. button: "${text?.trim() || value || 'no text'}"`;
            } catch {
              return `${i + 1}. button: "no text"`;
            }
          })
        );

        const linkTexts = await Promise.all(
          links.map(async (link, i) => {
            try {
              const text = await link.textContent();
              return `${buttonTexts.length + i + 1}. link: "${text?.trim() || 'no text'}"`;
            } catch {
              return `${buttonTexts.length + i + 1}. link: "no text"`;
            }
          })
        );

        const allElements = [...buttonTexts, ...linkTexts];
        return `Found ${allElements.length} clickable elements:\n${allElements.join('\n')}`;
      } catch (error) {
        return `Failed to list clickable elements: ${error}`;
      }
    },
    {
      name: "list_clickable_elements",
      description: "List all clickable buttons and links",
      schema: z.object({}),
    }
  );

  const solveCaptcha = tool(
    async ({ captchaFieldDescription }) => {
      try {
        const page = browser.getPage();
        if (!page) {
          return `Failed to solve CAPTCHA: Browser page not available`;
        }

        // Wait for page to be ready
        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});
        
        // Take screenshot and solve CAPTCHA directly
        const screenshot = await browser.captureScreenshot();
        const captchaText = await vision.solveCaptcha(screenshot);

        if (!captchaText) {
          return `Could not read CAPTCHA text - it may be too distorted`;
        }

        // Remove spaces from CAPTCHA text (VLM sometimes adds spaces between digits)
        const cleanedCaptchaText = captchaText.replace(/\s+/g, '');
        
        console.log(`Attempting to fill CAPTCHA with value: ${cleanedCaptchaText}`);

        // Try to fill the CAPTCHA field
        // Strategy 1: Try by name/id containing "captchaText" (BSES pattern) - visible only
        try {
          console.log('Strategy 1: Trying visible input[name*="captchaText" i], input[id*="captchaText" i]');
          const locator = page.locator('input[name*="captchaText" i], input[id*="captchaText" i]').locator('visible=true');
          const count = await locator.count();
          console.log(`Strategy 1: Found ${count} visible matching elements`);
          if (count > 0) {
            await locator.first().fill(cleanedCaptchaText, { timeout: 3000 });
            return `Successfully solved CAPTCHA and filled: ${cleanedCaptchaText}`;
          }
        } catch (e1) {
          console.log(`Strategy 1 failed: ${e1}`);
        }

        // Strategy 2: Try common CAPTCHA field patterns - visible only
        try {
          console.log('Strategy 2: Trying visible input[name*="captcha" i], input[id*="captcha" i]');
          const locator = page.locator('input[name*="captcha" i], input[id*="captcha" i]').locator('visible=true');
          const count = await locator.count();
          console.log(`Strategy 2: Found ${count} visible matching elements`);
          if (count > 0) {
            await locator.first().fill(cleanedCaptchaText, { timeout: 3000 });
            return `Successfully solved CAPTCHA and filled: ${cleanedCaptchaText}`;
          }
        } catch (e2) {
          console.log(`Strategy 2 failed: ${e2}`);
        }

        // Strategy 3: Try by label
        try {
          await page.getByLabel(new RegExp(captchaFieldDescription, 'i')).fill(cleanedCaptchaText, { timeout: 3000 });
          return `Successfully solved CAPTCHA and filled: ${cleanedCaptchaText}`;
        } catch (e3) {
          // Continue to next strategy
        }

        // Strategy 4: Try by placeholder
        try {
          await page.getByPlaceholder(new RegExp(captchaFieldDescription, 'i')).fill(cleanedCaptchaText, { timeout: 3000 });
          return `Successfully solved CAPTCHA and filled: ${cleanedCaptchaText}`;
        } catch (e4) {
          // Continue to next strategy
        }

        // Strategy 5: Try verification code patterns
        try {
          await page.locator('input[name*="code" i], input[id*="code" i], input[name*="verify" i]').first().fill(cleanedCaptchaText, { timeout: 3000 });
          return `Successfully solved CAPTCHA and filled: ${cleanedCaptchaText}`;
        } catch (e5) {
          // Continue to next strategy
        }

        // Strategy 6: Try by label text containing verification/captcha
        try {
          await page.getByLabel(/text.*verification|captcha|verify/i).fill(cleanedCaptchaText, { timeout: 3000 });
          return `Successfully solved CAPTCHA and filled: ${cleanedCaptchaText}`;
        } catch (e6) {
          // Continue to next strategy
        }

        // Strategy 7: Find input near CAPTCHA image
        try {
          const captchaImg = page.locator('img[alt*="captcha" i], img[class*="captcha" i], img[id*="captcha" i]').first();
          const nearbyInput = captchaImg.locator('..').locator('input[type="text"]').first();
          await nearbyInput.fill(cleanedCaptchaText, { timeout: 3000 });
          return `Successfully solved CAPTCHA and filled: ${cleanedCaptchaText}`;
        } catch (e7) {
          // All strategies failed
        }

        return `Solved CAPTCHA (${cleanedCaptchaText}) but could not find field to fill it`;
      } catch (error) {
        return `Failed to solve CAPTCHA: ${error}`;
      }
    },
    {
      name: "solve_captcha",
      description: "Detect and solve basic alphanumeric CAPTCHA",
      schema: z.object({
        captchaFieldDescription: z.string().describe("Description of CAPTCHA input field"),
      }),
    }
  );

  const waitForPayment = tool(
    async ({}) => {
      if (!browser || !vision) {
        throw new Error("Browser or vision not initialized");
      }

      try {
        const page = await browser.getPage();
        if (!page) {
          return "No active page found.";
        }

        const totalWaitTime = 5 * 60 * 1000; // 5 minutes
        const heartbeatInterval = 30 * 1000; // Send heartbeat every 30 seconds
        const iterations = Math.floor(totalWaitTime / heartbeatInterval);
        
        console.log('Waiting 5 minutes for payment completion...');
        console.log('Note: Staying on current page, waiting for automatic redirect to success page');
        console.log(`Sending heartbeat every ${heartbeatInterval / 1000} seconds to keep connection alive`);

        // Wait in intervals with heartbeat messages
        for (let i = 0; i < iterations; i++) {
          await page.waitForTimeout(heartbeatInterval);
          const elapsed = ((i + 1) * heartbeatInterval) / 1000;
          console.log(`⏱️ Payment wait progress: ${elapsed}s / 300s (${Math.round((elapsed / 300) * 100)}%)`);
        }

        console.log('5 minutes elapsed, checking payment status now...');

        // Take screenshot and check for payment success
        const screenshot = await browser.captureScreenshot();
        const pageText = await page.textContent('body') || '';

        const isSuccess = await vision.detectPaymentSuccess(screenshot, pageText);

        if (isSuccess) {
          console.log('Payment successful!');
          return JSON.stringify({
            success: true,
            message: "Payment completed successfully after 5 minutes.",
            elapsedSeconds: 300
          }, null, 2);
        }

        // Check for failure/error pages
        const failureKeywords = ['failed', 'error', 'declined', 'rejected', 'cancelled', 'timeout', 'unsuccessful'];
        const pageTextLower = pageText.toLowerCase();
        
        for (const keyword of failureKeywords) {
          if (pageTextLower.includes(keyword)) {
            console.log(`Payment failure detected: ${keyword}`);
            return JSON.stringify({
              success: false,
              message: `Payment failed: ${keyword} detected on page.`,
              reason: keyword,
              elapsedSeconds: 300
            }, null, 2);
          }
        }

        // No clear success or failure - payment likely not completed
        console.log('⚠️  Payment status unclear after 5 minutes - likely not completed');
        console.log('Page did not show success or failure confirmation');
        return JSON.stringify({
          success: false,
          message: "Payment not completed: No confirmation detected after 5 minutes. Payment likely timed out or was not initiated.",
          reason: "timeout_no_payment",
          elapsedSeconds: 300
        }, null, 2);
      } catch (error) {
        return `Error waiting for payment: ${error}`;
      }
    },
    {
      name: "wait_for_payment",
      description: "Wait exactly 5 minutes for payment completion after QR scan or UPI ID entry, then check once. Stays on current page without navigation. Returns success, failure, or unclear status.",
      schema: z.object({}),
    }
  );

  const selectPaymentOption = tool(
    async ({ paymentMethodName }) => {
      try {
        const page = browser.getPage();
        if (!page) {
          return `Failed to select payment option: Browser page not available`;
        }

        await page.waitForLoadState('domcontentloaded', { timeout: 5000 }).catch(() => {});

        console.log(`Attempting to select payment option: ${paymentMethodName}`);

        // Strategy 0A: Try clicking on tab/link/button/div elements (for BillDesk tabs, Jio buttons, etc.)
        try {
          const keywords = paymentMethodName.toLowerCase().replace(/\s+/g, '');
          
          console.log(`Strategy 0A: Looking for tab/link/button with keyword: ${keywords}`);
          
          // Try finding elements with payment method name in various formats
          // Covers: BillDesk <a> tabs, Jio <div> buttons, generic <button> elements
          const tabLocator = page.locator(
            // Anchor tags (BillDesk style)
            `a[data-value*="${keywords}" i], ` +
            `a[href*="${keywords}" i], ` +
            `a:has(i[class*="${keywords}" i]), ` +
            `a:has(.bdi-${keywords}), ` +
            `li:has-text("${paymentMethodName}") > a, ` +
            // Div/Button elements with text (Jio style)
            `div:has-text("${paymentMethodName}"), ` +
            `button:has-text("${paymentMethodName}"), ` +
            // Elements with "Pay via QR", "QR Code", etc.
            `div:has-text("Pay via ${paymentMethodName}"), ` +
            `button:has-text("Pay via ${paymentMethodName}")`
          );
          const count = await tabLocator.count();
          
          console.log(`Strategy 0A: Found ${count} matching tab/link elements`);
          
          if (count > 0) {
            await tabLocator.first().click({ timeout: 15000 });
            console.log(`✅ Selected payment option by clicking tab/link element`);
            // Wait for tab content to load
            await page.waitForTimeout(1000);
            return `Successfully selected "${paymentMethodName}" payment option using tab/link`;
          }
        } catch (e0a) {
          console.log(`Strategy 0A (tab/link) failed: ${e0a}`);
        }

        // Strategy 0B: Try clicking visible wrapper element with role="radio" (for hidden radio buttons)
        // This handles cases like <span role="radio" id="billdesk"> wrapping <input id="billdesk-RB">
        try {
          const keywords = paymentMethodName.toLowerCase().replace(/\s+/g, '');
          const wrapperLocator = page.locator(`[role="radio"][id*="${keywords}" i], [role="radio"][data-id*="${keywords}" i]`);
          const count = await wrapperLocator.count();
          if (count > 0) {
            await wrapperLocator.first().click({ timeout: 15000, force: true });
            console.log(`Selected payment option using visible wrapper with role=radio`);
            return `Successfully selected "${paymentMethodName}" payment option using wrapper element`;
          }
        } catch (e0b) {
          console.log(`Strategy 0B failed: ${e0b}`);
        }

        // Strategy 1: Try radio button by data-title, ID or name attribute, handle hidden radios
        try {
          const keywords = paymentMethodName.toLowerCase().replace(/\s+/g, '');
          
          // First try data-title attribute (used by BillDesk for UPI apps like GooglePay, PhonePe)
          console.log(`Strategy 1: Looking for radio with data-title="${paymentMethodName}"`);
          let radioLocator = page.locator(`input[type="radio"][data-title="${paymentMethodName}" i]`);
          let count = await radioLocator.count();
          
          console.log(`Strategy 1: Found ${count} radios with data-title`);
          
          // If not found, try ID or name attribute
          if (count === 0) {
            radioLocator = page.locator(`input[type="radio"][id*="${keywords}" i], input[type="radio"][name*="${keywords}" i]`);
            count = await radioLocator.count();
            console.log(`Strategy 1: Found ${count} radios with id/name`);
          }
          
          if (count > 0) {
            const radio = radioLocator.first();
            const isVisible = await radio.isVisible().catch(() => false);
            
            if (isVisible) {
              await radio.click({ timeout: 15000 });
              console.log(`✅ Selected payment option using visible radio button`);
              return `Successfully selected "${paymentMethodName}" payment option using radio button`;
            } else {
              // Radio is hidden, try to find and click associated label or wrapper
              console.log(`Radio button is hidden, looking for clickable wrapper...`);
              
              // Try clicking parent label first (common for BillDesk UPI apps)
              const parent = radio.locator('..');
              const parentTag = await parent.evaluate((el) => el.tagName).catch(() => '');
              if (parentTag === 'LABEL') {
                console.log(`Clicking parent label to select radio`);
                await parent.click({ timeout: 15000 });
                console.log(`✅ Selected payment option by clicking parent label`);
                return `Successfully selected "${paymentMethodName}" payment option via parent label`;
              }
              
              const radioId = await radio.getAttribute('id').catch(() => '');
              if (radioId) {
                // Try clicking label with for attribute
                const labelLocator = page.locator(`label[for="${radioId}"]`);
                const labelCount = await labelLocator.count();
                if (labelCount > 0) {
                  await labelLocator.first().click({ timeout: 15000 });
                  console.log(`✅ Selected payment option by clicking label for hidden radio`);
                  return `Successfully selected "${paymentMethodName}" payment option via label`;
                }
                
                // Try clicking parent wrapper (span/div with role=radio)
                const parentRole = await parent.getAttribute('role').catch(() => '');
                if (parentRole === 'radio') {
                  await parent.click({ timeout: 15000, force: true });
                  console.log(`✅ Selected payment option by clicking parent wrapper with role=radio`);
                  return `Successfully selected "${paymentMethodName}" payment option via parent wrapper`;
                }
              }
              
              // Try force clicking the hidden radio as last resort
              await radio.click({ timeout: 15000, force: true });
              console.log(`✅ Selected payment option using force click on hidden radio`);
              return `Successfully selected "${paymentMethodName}" payment option using force click`;
            }
          }
        } catch (e1) {
          console.log(`Strategy 1 failed: ${e1}`);
        }

        // Strategy 2: Try clicking on radio button by aria-label or aria-describedby
        try {
          const radioLocator = page.locator(`input[type="radio"][aria-label*="${paymentMethodName}" i], input[type="radio"][aria-describedby*="${paymentMethodName}" i]`);
          const count = await radioLocator.count();
          if (count > 0) {
            await radioLocator.first().click({ timeout: 15000 });
            console.log(`Selected payment option using aria attributes`);
            return `Successfully selected "${paymentMethodName}" payment option using aria attributes`;
          }
        } catch (e2) {
          console.log(`Strategy 2 failed: ${e2}`);
        }

        // Strategy 3: Try clicking on label associated with radio button
        try {
          const labelLocator = page.locator(`label:has-text("${paymentMethodName}")`);
          const count = await labelLocator.count();
          if (count > 0) {
            await labelLocator.first().click({ timeout: 15000 });
            console.log(`Selected payment option by clicking label`);
            return `Successfully selected "${paymentMethodName}" payment option by clicking label`;
          }
        } catch (e3) {
          console.log(`Strategy 3 failed: ${e3}`);
        }

        // Strategy 4: Try clicking on image with alt text, src, or data-bank matching payment method name
        // Handles variations: "Bill Desk" → "billdesk", "bill-desk", "bill_desk" in filenames
        // Also handles BillDesk UPI apps: GooglePay → data-bank="CPI-DIRECT", class="pp-cpi"
        try {
          const nameNoSpaces = paymentMethodName.toLowerCase().replace(/\s+/g, '');
          const nameWithHyphens = paymentMethodName.toLowerCase().replace(/\s+/g, '-');
          const nameWithUnderscores = paymentMethodName.toLowerCase().replace(/\s+/g, '_');
          
          console.log(`Strategy 4: Looking for image with keyword: ${nameNoSpaces}`);
          
          const imgLocator = page.locator(
            `img[alt*="${paymentMethodName}" i], ` +
            `img[src*="${nameNoSpaces}" i], ` +
            `img[src*="${nameWithHyphens}" i], ` +
            `img[src*="${nameWithUnderscores}" i], ` +
            `img[data-bank*="${nameNoSpaces}" i], ` +  // BillDesk uses data-bank attribute
            `img[class*="${nameNoSpaces}" i]`          // BillDesk uses class like "pp-cpi" for GooglePay
          );
          const count = await imgLocator.count();
          
          console.log(`Strategy 4: Found ${count} matching images`);
          
          if (count > 0) {
            console.log(`Found image matching payment method: ${paymentMethodName}`);
            // Try to find associated radio button near the image
            const parentLocator = imgLocator.first().locator('..');
            const radioInParent = parentLocator.locator('input[type="radio"]');
            const radioCount = await radioInParent.count();
            
            if (radioCount > 0) {
              const radio = radioInParent.first();
              const isVisible = await radio.isVisible().catch(() => false);
              
              // Try clicking the parent label first (common pattern for UPI apps)
              const labelParent = await parentLocator.evaluate((el) => el.tagName);
              if (labelParent === 'LABEL') {
                console.log(`Clicking label element to select radio`);
                await parentLocator.click({ timeout: 15000 });
              } else if (isVisible) {
                await radio.click({ timeout: 15000 });
              } else {
                // Radio is hidden, click parent or use force
                await radio.click({ timeout: 15000, force: true });
              }
              console.log(`✅ Selected payment option by clicking radio near image`);
              return `Successfully selected "${paymentMethodName}" payment option using image-based selector`;
            } else {
              // No radio in parent, check sibling containers (for structures like BSES where radio and image are siblings)
              console.log(`No radio in image parent, checking sibling containers...`);
              const grandparent = parentLocator.locator('..');
              const radioInGrandparent = grandparent.locator('input[type="radio"]');
              const radioInGrandparentCount = await radioInGrandparent.count();
              
              if (radioInGrandparentCount > 0) {
                const radio = radioInGrandparent.first();
                const isVisible = await radio.isVisible().catch(() => false);
                if (isVisible) {
                  await radio.click({ timeout: 15000 });
                } else {
                  await radio.click({ timeout: 15000, force: true });
                }
                console.log(`Selected payment option by clicking radio in sibling container`);
                return `Successfully selected "${paymentMethodName}" payment option using sibling container`;
              }
              
              // No radio found, try clicking the image itself or its parent container
              try {
                await imgLocator.first().click({ timeout: 15000 });
                console.log(`Selected payment option by clicking image`);
                return `Successfully selected "${paymentMethodName}" payment option by clicking image`;
              } catch {
                // Try clicking parent container
                await parentLocator.click({ timeout: 15000 });
                console.log(`Selected payment option by clicking image container`);
                return `Successfully selected "${paymentMethodName}" payment option by clicking image container`;
              }
            }
          }
        } catch (e4) {
          console.log(`Strategy 4 failed: ${e4}`);
        }

        // Strategy 5: Try finding radio button in a container that has the payment method text or image
        try {
          // Find container with text matching payment method
          const containerLocator = page.locator(`div:has-text("${paymentMethodName}"), span:has-text("${paymentMethodName}")`);
          const count = await containerLocator.count();
          
          if (count > 0) {
            // Look for radio button within or near this container
            const radioLocator = containerLocator.first().locator('input[type="radio"]');
            const radioCount = await radioLocator.count();
            
            if (radioCount > 0) {
              await radioLocator.first().click({ timeout: 15000 });
              console.log(`Selected payment option using container-based selector`);
              return `Successfully selected "${paymentMethodName}" payment option from container`;
            }
          }
        } catch (e5) {
          console.log(`Strategy 5 failed: ${e5}`);
        }

        // Strategy 6: Try clicking on any element (div, span) that contains the payment method image or text
        try {
          const nameNoSpaces = paymentMethodName.toLowerCase().replace(/\s+/g, '');
          const nameWithHyphens = paymentMethodName.toLowerCase().replace(/\s+/g, '-');
          const nameWithUnderscores = paymentMethodName.toLowerCase().replace(/\s+/g, '_');
          
          const clickableLocator = page.locator(
            `div:has(img[alt*="${paymentMethodName}" i]), ` +
            `div:has(img[src*="${nameNoSpaces}" i]), ` +
            `div:has(img[src*="${nameWithHyphens}" i]), ` +
            `div:has(img[src*="${nameWithUnderscores}" i])`
          );
          const count = await clickableLocator.count();
          
          if (count > 0) {
            await clickableLocator.first().click({ timeout: 15000 });
            console.log(`Selected payment option by clicking container with image`);
            return `Successfully selected "${paymentMethodName}" payment option by clicking container`;
          }
        } catch (e6) {
          console.log(`Strategy 6 failed: ${e6}`);
        }

        // Strategy 7: Use role="radio" with accessible name
        try {
          await page.getByRole('radio', { name: new RegExp(paymentMethodName, 'i') }).click({ timeout: 15000 });
          console.log(`Selected payment option using role=radio`);
          return `Successfully selected "${paymentMethodName}" payment option using role`;
        } catch (e7) {
          console.log(`Strategy 7 failed: ${e7}`);
        }

        // Strategy 8: Find all radio buttons and match by nearby text/image
        try {
          const allRadios = await page.locator('input[type="radio"]').all();
          
          for (const radio of allRadios) {
            const parent = radio.locator('..');
            const parentText = await parent.textContent().catch(() => '');
            const hasMatchingText = parentText?.toLowerCase().includes(paymentMethodName.toLowerCase());
            
            // Check for matching image in parent
            const imgInParent = parent.locator('img');
            const imgCount = await imgInParent.count();
            let hasMatchingImage = false;
            
            if (imgCount > 0) {
              const imgAlt = await imgInParent.first().getAttribute('alt').catch(() => '');
              const imgSrc = await imgInParent.first().getAttribute('src').catch(() => '');
              const nameNoSpaces = paymentMethodName.toLowerCase().replace(/\s+/g, '');
              const nameWithHyphens = paymentMethodName.toLowerCase().replace(/\s+/g, '-');
              const nameWithUnderscores = paymentMethodName.toLowerCase().replace(/\s+/g, '_');
              
              hasMatchingImage = !!(
                imgAlt?.toLowerCase().includes(paymentMethodName.toLowerCase()) ||
                imgSrc?.toLowerCase().includes(nameNoSpaces) ||
                imgSrc?.toLowerCase().includes(nameWithHyphens) ||
                imgSrc?.toLowerCase().includes(nameWithUnderscores)
              );
            }
            
            if (hasMatchingText || hasMatchingImage) {
              await radio.click({ timeout: 15000 });
              console.log(`Selected payment option by iterating through radio buttons`);
              return `Successfully selected "${paymentMethodName}" payment option by matching nearby content`;
            }
          }
        } catch (e8) {
          console.log(`Strategy 8 failed: ${e8}`);
        }

        return `Could not find payment option matching: ${paymentMethodName}. Please verify the payment method name.`;
      } catch (error) {
        return `Failed to select payment option: ${error}`;
      }
    },
    {
      name: "select_payment_option",
      description: "Select a payment method/option from radio buttons, images, or clickable elements. Works with both text-based and image-based payment options (e.g., 'Bill Desk', 'City Union Bank', 'UPI', 'Credit Card').",
      schema: z.object({
        paymentMethodName: z.string().describe("Name of the payment method to select (e.g., 'Bill Desk', 'UPI', 'Credit Card')"),
      }),
    }
  );

  const handleDialog = tool(
    async ({ action, promptText }) => {
      if (!browser) {
        throw new Error("Browser not initialized");
      }

      try {
        // Check if there's a dialog present
        if (!browser.hasDialog()) {
          return "No dialog/popup detected on the page.";
        }

        const dialogMessage = browser.getDialogMessage();
        console.log(`Dialog present with message: "${dialogMessage}"`);

        if (action === "accept") {
          await browser.acceptDialog(promptText);
          return JSON.stringify({
            success: true,
            action: "accepted",
            message: dialogMessage,
            promptText: promptText || "N/A"
          }, null, 2);
        } else if (action === "dismiss") {
          await browser.dismissDialog();
          return JSON.stringify({
            success: true,
            action: "dismissed",
            message: dialogMessage
          }, null, 2);
        } else {
          return `Invalid action: ${action}. Use 'accept' or 'dismiss'.`;
        }
      } catch (error) {
        return `Failed to handle dialog: ${error}`;
      }
    },
    {
      name: "handle_dialog",
      description: "Handle browser dialogs/popups (alert, confirm, prompt). Use 'accept' to confirm or 'dismiss' to cancel. For prompt dialogs, provide promptText.",
      schema: z.object({
        action: z.enum(["accept", "dismiss"]).describe("Action to take on the dialog: 'accept' to confirm, 'dismiss' to cancel"),
        promptText: z.string().optional().describe("Text to enter in prompt dialog (only for prompt type dialogs)")
      }),
    }
  );

  const scanUpiQrCode = tool(
    async ({}) => {
      if (!browser) {
        throw new Error("Browser not initialized");
      }

      try {
        const page = await browser.getPage();
        if (!page) {
          return "No active page found. Please navigate to a payment page first.";
        }

        console.log('🔍 Extracting QR code image URL from page...');
        
        // Wait for loading spinner to disappear (QR page loads dynamically)
        console.log('⏳ Waiting for page to finish loading...');
        try {
          await page.waitForSelector('[data-testid="central-loader"]', { state: 'hidden', timeout: 15000 });
          console.log('✅ Loading spinner disappeared');
        } catch (e) {
          console.log('⚠️ Loading spinner timeout or not found, proceeding anyway...');
        }
        
        // Wait additional time for QR code to render
        console.log('⏳ Waiting 3 more seconds for QR code to render...');
        await page.waitForTimeout(3000);

        // Extract QR code image URL (handles both <img> and <svg> elements)
        const qrImageUrl = await page.evaluate(() => {
          try {
            console.log('🔍 [Browser] Starting QR code detection...');
            
            // First, try to find SVG QR codes (like Jio)
            console.log('🔍 [Browser] Searching for SVG elements...');
            const allSvgs = Array.from(document.querySelectorAll('svg'));
            console.log(`🔍 [Browser] Found ${allSvgs.length} SVG elements`);
          for (const svg of allSvgs) {
            const width = svg.getAttribute('width') || svg.clientWidth;
            const height = svg.getAttribute('height') || svg.clientHeight;
            
            // QR codes are typically square and reasonably sized
            const numWidth = typeof width === 'string' ? parseInt(width) : width;
            const numHeight = typeof height === 'string' ? parseInt(height) : height;
            
            if (numWidth < 100 || numHeight < 100) continue;
            
            // Check if parent or nearby elements mention QR
            const parentText = svg.parentElement?.textContent?.toLowerCase() || '';
            const parentClass = svg.parentElement?.className?.toLowerCase() || '';
            const hasQrContext = parentText.includes('qr') || parentText.includes('scan') || parentClass.includes('qr');
            
            // SVG QR codes can have either:
            // 1. Many path elements (multiple small paths)
            // 2. Few paths but with complex d attributes (single large path with many coordinates)
            const paths = svg.querySelectorAll('path');
            const pathCount = paths.length;
            
            // Check if any path has a complex d attribute (QR pattern)
            let hasComplexPath = false;
            for (const path of Array.from(paths)) {
              const d = path.getAttribute('d') || '';
              // QR codes have many M (moveto) commands in the path
              const movetoCount = (d.match(/M /g) || []).length;
              if (movetoCount > 20) {
                hasComplexPath = true;
                break;
              }
            }
            
            const looksLikeQr = pathCount > 10 || (pathCount >= 1 && hasComplexPath);
            
            if (hasQrContext && looksLikeQr) {
              console.log(`✅ [Browser] SVG QR code found with ${pathCount} paths, complex: ${hasComplexPath}`);
              // Mark SVG for screenshot (prevents data corruption)
              svg.setAttribute('data-qr-screenshot-target', 'true');
              return { type: 'svg', found: true };
            }
          }

          // Fallback: Try to find IMG QR codes
          const allImages = Array.from(document.querySelectorAll('img'));
          
          for (const img of allImages) {
            const src = img.src.toLowerCase();
            const alt = (img.alt || '').toLowerCase();
            const className = (img.className || '').toLowerCase();
            
            // Skip SVG icons and decorative images
            if (src.includes('icon') || src.includes('.svg')) continue;
            if (className.includes('icon') || className.includes('logo')) continue;
            if (alt.includes('icon') && !alt.includes('qr code')) continue;
            
            // Skip tiny images
            const width = img.naturalWidth || img.width;
            const height = img.naturalHeight || img.height;
            if (width < 100 || height < 100) continue;
            
            // Check if this looks like a QR code image
            const hasQrInTestId = img.getAttribute('data-testid')?.toLowerCase().includes('qr');
            const hasQrInAlt = alt.includes('qr');
            const hasQrInSrc = src.includes('/qr/') || src.includes('qr-code') || src.includes('qrcode') || src.includes('paydigi');
            const hasQrInClass = className.includes('qr');
            const parentHasQr = img.parentElement?.className?.toLowerCase().includes('qr');
            
            if (hasQrInTestId || hasQrInAlt || hasQrInSrc || hasQrInClass || parentHasQr) {
              console.log('✅ [Browser] IMG QR code found:', src.substring(0, 50));
              // Mark IMG for screenshot
              img.setAttribute('data-qr-screenshot-target', 'true');
              return { type: 'img', found: true };
            }
          }
          
          console.log('❌ [Browser] No QR code found');
          return { found: false };
          
          } catch (error) {
            console.log(`❌ [Browser] Fatal error in QR detection: ${error}`);
            return { found: false };
          }
        });

        console.log('📊 QR detection result:', qrImageUrl.found ? `Found (${qrImageUrl.type})` : 'Not found');

        if (!qrImageUrl.found) {
          console.log('❌ No QR code found on page');
          return "No UPI QR code found on the current page. The QR code may still be loading or not present.";
        }

        // Screenshot the QR code element (pixel-perfect, zero data corruption)
        console.log('📸 Taking screenshot of QR code element...');
        const qrLocator = page.locator('[data-qr-screenshot-target="true"]');
        const screenshotBuffer = await qrLocator.screenshot({ type: 'png' });
        
        // Convert PNG buffer to base64 data URL
        const base64 = screenshotBuffer.toString('base64');
        const qrDataUrl = `data:image/png;base64,${base64}`;
        console.log('✅ QR code screenshot captured:', qrDataUrl.length, 'bytes');

        // Send QR URL to user's phone via HTTP POST to Supabase function
        const notificationUrl = process.env.PAYMENT_NOTIFICATION_URL;
        const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
        
        console.log('\n=== PUSH NOTIFICATION STATUS ===');
        if (notificationUrl && supabaseAnonKey) {
          try {
            console.log('📱 Sending payment notification to user\'s phone...');
            console.log('Notification URL:', notificationUrl);
            console.log('Payment Data:', JSON.stringify(paymentData, null, 2));
            
            const payload = {
              paymentData: paymentData || { paymentType: "unknown" },
              paymentUrl: qrDataUrl
            };
            
            const response = await fetch(notificationUrl, {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${supabaseAnonKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify(payload)
            });
            
            if (response.ok) {
              const responseData = await response.text();
              console.log('✅ NOTIFICATION SENT SUCCESSFULLY!');
              console.log('Response:', responseData);
            } else {
              const errorText = await response.text();
              console.error('❌ NOTIFICATION FAILED!');
              console.error('Status:', response.status);
              console.error('Error:', errorText);
            }
          } catch (error) {
            console.error('❌ NOTIFICATION ERROR!');
            console.error('Error details:', error);
          }
        } else {
          console.log('⚠️  NOTIFICATION NOT CONFIGURED!');
          console.log('Missing environment variables:');
          if (!notificationUrl) console.log('  - PAYMENT_NOTIFICATION_URL is not set');
          if (!supabaseAnonKey) console.log('  - SUPABASE_ANON_KEY is not set');
          console.log('\nTo enable push notifications, add these to your .env file:');
          console.log('  PAYMENT_NOTIFICATION_URL=https://your-supabase-function-url');
          console.log('  SUPABASE_ANON_KEY=your-supabase-anon-key');
          console.log('\nUser will NOT receive QR code on their phone.');
        }
        console.log('================================\n');

        return JSON.stringify({
          success: true,
          qrCodeUrl: qrDataUrl,
          message: "QR code screenshot captured and sent to your phone. Please complete payment within 5 minutes. Use wait_for_payment tool to check payment status.",
        }, null, 2);
      } catch (error) {
        return `Failed to extract QR code: ${error}`;
      }
    },
    {
      name: "scan_upi_qr_code",
      description: "Extract QR code image URL from payment page. CRITICAL: Only use AFTER clicking all required buttons (Make Payment, Proceed, Show QR). QR code is NOT visible immediately after clicking QR tab - you must click buttons first to reveal it. Check user prompt for button click steps before using this tool.",
      schema: z.object({}),
    }
  );

  return [
    navigateToWebsite,
    analyzeCurrentPage,
    fillFormField,
    clickButton,
    selectDropdownOption,
    selectPaymentOption,
    checkPaymentSuccess,
    getCurrentPageInfo,
    listClickableElements,
    solveCaptcha,
    handleDialog,
    waitForPayment,
    scanUpiQrCode,
  ];
}
