/**
 * Payment Tools
 *
 * Vision-based tools for generic payment automation.
 * These tools use Groq's Llama Vision model to detect and interact with
 * page elements without hardcoded selectors.
 */

import "dotenv/config";
import { BrowserManager } from "./browser.js";
import { VisionAnalyzer } from "./vision.js";
import { createPaymentTools } from "./payment-tools.js";

const groqApiKey = process.env.GROQ_API_KEY;

if (!groqApiKey) {
  throw new Error("GROQ_API_KEY environment variable is required");
}

const browser = new BrowserManager();
const vision = new VisionAnalyzer();

/**
 * All payment tools available to the agent.
 * These tools enable vision-based payment automation:
 * - navigate_to_website: Navigate to payment URLs
 * - analyze_current_page: Vision AI page analysis
 * - fill_form_field: Fill inputs by description
 * - click_button: Click buttons by description
 * - select_dropdown_option: Select from dropdowns
 * - check_payment_success: Verify payment completion
 * - get_current_page_info: Get current page details
 */
export const TOOLS = createPaymentTools(browser, vision);
