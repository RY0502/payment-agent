import {
  FreeTierOrchestrator,
  createProviders,
  type Provider,
  type LlmInput,
} from "@freetier/orchestrator";
import { VisionAnalysisResult } from "./types.js";

/**
 * Preferred provider failover order for vision calls.
 * Providers without a configured API key are automatically skipped by createProviders().
 */
const PROVIDER_PRIORITY = ["Cloudflare", "NVIDIA", "Groq"];

function buildOrchestrator(): FreeTierOrchestrator<LlmInput, string> {
  const providers: Provider<LlmInput, string>[] = createProviders();
  const ordered = [...providers].sort((a, b) => {
    const rankA = PROVIDER_PRIORITY.indexOf(a.name);
    const rankB = PROVIDER_PRIORITY.indexOf(b.name);
    return (rankA === -1 ? PROVIDER_PRIORITY.length : rankA) - (rankB === -1 ? PROVIDER_PRIORITY.length : rankB);
  });
  return new FreeTierOrchestrator<LlmInput, string>(ordered);
}

export class VisionAnalyzer {
  private orchestrator: FreeTierOrchestrator<LlmInput, string>;

  constructor() {
    this.orchestrator = buildOrchestrator();
  }

  async analyzePaymentPage(
    screenshot: string,
    paymentData: any,
    currentStep: string
  ): Promise<VisionAnalysisResult> {
    const prompt = `You are a web automation expert analyzing a payment webpage.

CURRENT STEP: ${currentStep}
PAYMENT DATA: ${JSON.stringify(paymentData, null, 2)}

Analyze the screenshot to determine:
1. What type of page is this? (login, form, payment, confirmation, error, etc.)
2. What form fields and buttons are visible?
3. Is there a CAPTCHA image or verification code on the page?
4. What action should be taken next?
5. Is this a payment success/confirmation page?

Respond in JSON format:
{
  "pageType": "form|login|payment|confirmation|error|other",
  "visibleFields": ["field1", "field2", ...],
  "visibleButtons": ["button1", "button2", ...],
  "hasCaptcha": true|false,
  "suggestedAction": "describe the next action to take",
  "isPaymentSuccessPage": true|false,
  "reasoning": "explain your analysis"
}`;

    const content = await this.orchestrator.invoke({
      system: "You are a web automation expert analyzing payment webpages.",
      prompt,
      imageBase64: screenshot,
    });
    
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
    } catch (error) {
      console.error("Failed to parse VLM response:", error);
    }

    return {
      pageType: "unknown",
      identifiedElements: [],
      suggestedAction: "Unable to analyze page",
      isPaymentSuccessPage: false,
      reasoning: "Failed to parse VLM response",
    };
  }

  async findElementByIntent(
    screenshot: string,
    accessibilityTree: string,
    intent: string
  ): Promise<string | null> {
    const prompt = `Given this webpage screenshot and accessibility tree, find the CSS selector for: ${intent}

Accessibility Tree:
${accessibilityTree}

Return ONLY the CSS selector, nothing else. If not found, return "null".`;

    try {
      const content = await this.orchestrator.invoke({
        system: "You are a web automation expert locating page elements.",
        prompt,
        imageBase64: screenshot,
      });

      const selector = content.trim();
      return selector === "null" ? null : selector || null;
    } catch (error) {
      console.error("Vision analysis error:", error);
      return null;
    }
  }

  async detectCaptcha(screenshot: string): Promise<boolean> {
    const prompt = `Look at this webpage screenshot. Is there a CAPTCHA present on the page?
A CAPTCHA is typically:
- An image with distorted text/numbers
- A "I'm not a robot" checkbox
- A puzzle or challenge to prove you're human
- Text like "Enter the code shown" or "Verify you're human"

Answer with ONLY "yes" or "no".`;

    try {
      const content = await this.orchestrator.invoke({
        system: "You are a web automation expert detecting CAPTCHAs.",
        prompt,
        imageBase64: screenshot,
      });

      const answer = content.trim().toLowerCase();
      console.log(`Vision model CAPTCHA detection response: "${answer}"`);
      const result = answer === "yes";
      console.log(`Returning hasCaptcha: ${result}`);
      return result;
    } catch (error) {
      console.error("CAPTCHA detection error:", error);
      return false;
    }
  }

  async solveCaptcha(screenshot: string): Promise<string | null> {
    const prompt = `Look at this webpage screenshot. There is a CAPTCHA image visible.
Please read the text/numbers shown in the CAPTCHA image.

Instructions:
- Look carefully at the CAPTCHA image
- Read the alphanumeric characters shown
- Return ONLY the characters you see, nothing else
- If you cannot read it clearly, return "UNREADABLE"
- Do not include spaces unless they are clearly part of the CAPTCHA
- Preserve the case (uppercase/lowercase) as shown

Return ONLY the CAPTCHA text:`;

    try {
      const content = await this.orchestrator.invoke({
        system: "You are a web automation expert reading CAPTCHA text.",
        prompt,
        imageBase64: screenshot,
      });

      const captchaText = content.trim();
      return captchaText === "UNREADABLE" ? null : captchaText || null;
    } catch (error) {
      console.error("CAPTCHA solving error:", error);
      return null;
    }
  }


  async detectPaymentSuccess(screenshot: string, pageText: string): Promise<boolean> {
    const prompt = `Analyze this webpage to determine if it shows a successful payment confirmation.

PAGE TEXT CONTENT:
${pageText.substring(0, 1000)}

Look for indicators like:
- "Payment successful", "Transaction complete", "Confirmation"
- Order/Transaction/Reference numbers
- Success checkmarks or icons
- Thank you messages
- Receipt or confirmation details

Respond with JSON:
{
  "isSuccess": true|false,
  "confidence": 0.0-1.0,
  "reasoning": "explain your decision"
}`;

    const content = await this.orchestrator.invoke({
      system: "You are a web automation expert detecting payment success confirmations.",
      prompt,
      imageBase64: screenshot,
    });
    
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const result = JSON.parse(jsonMatch[0]);
        return result.isSuccess && result.confidence > 0.7;
      }
    } catch (error) {
      console.error("Failed to parse success detection:", error);
    }

    return false;
  }
}
