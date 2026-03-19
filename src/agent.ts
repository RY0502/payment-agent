/**
 * Payment Agent Graph
 *
 * This module exports the payment automation graph for LangGraph.
 * The graph uses Groq's vision LLM for payment automation and supports:
 * - Vision-based element detection
 * - Generic payment automation across different websites
 * - ReAct pattern (Reason → Act → Observe)
 * - Automatic retry logic (up to 5 attempts per step)
 * - Payment success detection
 */

import "dotenv/config";
import { StateGraph, START, END, Annotation } from "@langchain/langgraph";
import { ChatGroq } from "@langchain/groq";
import { AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { BrowserManager } from "./browser.js";
import { VisionAnalyzer } from "./vision.js";
import { createPaymentTools } from "./payment-tools.js";
import { PaymentData } from "./types.js";
import { EmailService } from "./email-service.js";

const groqApiKey = process.env.GROQ_API_KEY;

if (!groqApiKey) {
  throw new Error("GROQ_API_KEY environment variable is required");
}

const MAX_ATTEMPTS_PER_STEP = 3;

const PaymentStateAnnotation = Annotation.Root({
  messages: Annotation<any[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  paymentData: Annotation<PaymentData>({
    reducer: (left, right) => right || left,
    default: () => ({ paymentType: "" }),
  }),
  targetUrl: Annotation<string>({
    reducer: (left, right) => right || left,
    default: () => "",
  }),
  currentUrl: Annotation<string>({
    reducer: (left, right) => right || left,
    default: () => "",
  }),
  currentStep: Annotation<string>({
    reducer: (left, right) => right || left,
    default: () => "initial",
  }),
  attemptCount: Annotation<number>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => 0,
  }),
  maxAttempts: Annotation<number>({
    reducer: (left, right) => right || left,
    default: () => MAX_ATTEMPTS_PER_STEP,
  }),
  isPaymentComplete: Annotation<boolean>({
    reducer: (left, right) => (right !== undefined ? right : left),
    default: () => false,
  }),
  confirmationDetails: Annotation<string>({
    reducer: (left, right) => right || left,
    default: () => "",
  }),
  error: Annotation<string>({
    reducer: (left, right) => right || left,
    default: () => "",
  }),
});

type PaymentState = typeof PaymentStateAnnotation.State;

let browser: BrowserManager | null = null;
let vision: VisionAnalyzer | null = null;
let tools: any[] = [];
let llm: ChatGroq | null = null;
let currentPaymentData: any = null;

/**
 * Clear all agent state before a new run to prevent data conflicts
 * This ensures each payment run is completely independent
 */
async function clearAgentState() {
  console.log("Clearing agent state for new run...");
  
  // Close browser if it exists
  if (browser) {
    try {
      await browser.close();
      console.log("Previous browser instance closed");
    } catch (error) {
      console.error("Error closing previous browser:", error);
    }
  }
  
  // Reset all global state except currentPaymentData
  // currentPaymentData will be updated by ensureInitialized with new payment data
  browser = null;
  vision = null;
  tools = [];
  llm = null;
  // Note: NOT clearing currentPaymentData here - it will be updated in ensureInitialized
  
  // Clear any timeout trackers
  paymentStartTime.clear();
  
  console.log("Agent state cleared successfully");
}

async function ensureInitialized(paymentData?: any) {
  if (!browser) {
    browser = new BrowserManager();
    await browser.initialize();
  }
  if (!vision) {
    vision = new VisionAnalyzer(groqApiKey!);
  }
  // Update payment data and recreate tools if data changed
  if (paymentData && JSON.stringify(paymentData) !== JSON.stringify(currentPaymentData)) {
    console.log('🔍 Payment data updated, recreating tools with new data:', JSON.stringify(paymentData));
    console.log('🔍 Previous currentPaymentData was:', JSON.stringify(currentPaymentData));
    currentPaymentData = paymentData;
    tools = createPaymentTools(browser, vision, currentPaymentData);
    console.log('🔍 Tools recreated with paymentData:', JSON.stringify(currentPaymentData));
  } else if (tools.length === 0) {
    console.log('🔍 Creating tools for first time with currentPaymentData:', JSON.stringify(currentPaymentData));
    tools = createPaymentTools(browser, vision, currentPaymentData);
  } else {
    console.log('🔍 Tools already exist, currentPaymentData:', JSON.stringify(currentPaymentData));
  }
  if (!llm) {
    llm = new ChatGroq({
      apiKey: groqApiKey!,
      model: "llama-3.3-70b-versatile",
      //model: "openai/gpt-oss-120b",
      temperature: 0.1,
    });
  }
}

const PAYMENT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const paymentStartTime = new Map<string, number>();

async function agentNode(state: PaymentState) {
  // STEP 1: Extract payment data and URL from user message if not already provided
  let paymentData = state.paymentData;
  let targetUrl = state.targetUrl;
  
  // If paymentData is empty or only has paymentType, extract from user message
  if (!paymentData || Object.keys(paymentData).length <= 1 || !paymentData.paymentType || paymentData.paymentType === "") {
    console.log("🔍 Extracting payment details from user message...");
    
    // state.messages can contain strings or message objects
    // Find the first message that looks like user input
    let messageContent = "";
    
    for (const msg of state.messages) {
      if (typeof msg === 'string') {
        // Direct string message
        messageContent = msg;
        break;
      } else if (msg && typeof msg === 'object') {
        // Message object
        const constructorName = msg.constructor?.name;
        const role = (msg as any).role;
        
        if (constructorName === 'HumanMessage' || role === 'user' || role === 'human') {
          messageContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          break;
        }
      }
    }
    
    if (messageContent && messageContent.trim()) {
      console.log("🔍 User message content:", messageContent.substring(0, 200));
      
      // Use LLM to extract structured data
      await ensureInitialized();
      const extractionPrompt = `Extract payment information from this message. The message may contain step-by-step instructions or numbered lists - extract ALL relevant payment details from the ENTIRE message including all steps.

Return ONLY a JSON object with these fields (use empty string if not found):
{
  "paymentType": "electricity/water/gas/postpaid/prepaid/etc",
  "accountNumber": "account/consumer/BP/CA number (any identifier for the account)",
  "amount": "payment amount (just the number, no currency)",
  "mobileNumber": "mobile number (10 digits, could be called 'jio number' or 'phone number')",
  "email": "email address",
  "customerName": "customer name",
  "upiId": "UPI ID if mentioned (e.g., user@okicici, user@paytm)",
  "paymentGateway": "Payment gateway if mentioned (e.g., BillDesk, City Union Bank, Razorpay)",
  "targetUrl": "website URL to make payment (full URL starting with http/https)"
}

IMPORTANT: 
- Look through ALL steps/instructions in the message
- Extract mobile number even if called "jio number" or mentioned in step 2 or later
- Extract account number even if called "BP number", "CA number", "consumer number", etc.
- Extract amount even if mentioned as "10 rs", "500rs", "10 rupees" (just put the number like "10" or "500")
- Extract UPI ID if mentioned anywhere (usually in format: username@bankname)
- Extract payment gateway if mentioned (BillDesk, City Union Bank, etc.)
- Extract URL from step 1 or anywhere it's mentioned

User message: ${messageContent}

Return ONLY the JSON object, no other text.`;

      try {
        const extractionResponse = await llm!.invoke([new SystemMessage(extractionPrompt)]);
        const extractedText = typeof extractionResponse.content === 'string' ? extractionResponse.content : JSON.stringify(extractionResponse.content);
        console.log("🔍 LLM extraction response:", extractedText);
        
        // Parse JSON from response
        const jsonMatch = extractedText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const extracted = JSON.parse(jsonMatch[0]);
          console.log("✓ Extracted payment data:", JSON.stringify(extracted));
          
          // Update paymentData and targetUrl
          paymentData = {
            paymentType: extracted.paymentType || "",
            accountNumber: extracted.accountNumber || "",
            amount: extracted.amount || "",
            mobileNumber: extracted.mobileNumber || "",
            email: extracted.email || "",
            customerName: extracted.customerName || "",
            upiId: extracted.upiId || "",
            paymentGateway: extracted.paymentGateway || "",
          };
          
          targetUrl = extracted.targetUrl || state.targetUrl;
          
          // Update state with extracted data
          state.paymentData = paymentData;
          state.targetUrl = targetUrl;
        } else {
          console.log("⚠ No JSON found in LLM response");
        }
      } catch (error) {
        console.error("Error extracting payment data:", error);
      }
    } else {
      console.log("⚠ No user message content found in state.messages");
    }
  }
  
  await ensureInitialized(paymentData);
  
  // Check for timeout
  const sessionId = targetUrl;
  if (!paymentStartTime.has(sessionId)) {
    paymentStartTime.set(sessionId, Date.now());
  }
  
  const elapsed = Date.now() - paymentStartTime.get(sessionId)!;
  if (elapsed > PAYMENT_TIMEOUT_MS) {
    console.error('Payment flow timeout: 10 minutes exceeded');
    return {
      error: 'Payment flow timeout: 10 minutes exceeded',
      attemptCount: state.maxAttempts, // Force cleanup
    };
  }
  
  const systemPrompt = `You are a payment automation agent. Complete a MULTI-PAGE payment flow using the provided data.

Payment Data: ${JSON.stringify(state.paymentData)}
Target: ${state.targetUrl}
Current Attempt: ${state.attemptCount + 1}/${state.maxAttempts}

CRITICAL: This is a MULTI-PAGE flow. You will navigate through multiple pages:
- Page 1: Initial details (account number, etc.)
- Page 2: Additional details or verification (CAPTCHA, amount, etc.)
- Page 3: Payment method selection (QR code, card, UPI, etc.)
- Page 4: Final confirmation/success

YOUR WORKFLOW:
1. ALWAYS start by analyzing the CURRENT page with analyze_current_page
2. Based on what you see on THIS page, decide what action to take
3. Fill ONLY the fields that exist on THIS page (don't try to fill fields that aren't there)
4. If CAPTCHA is present on THIS page, solve it
5. If QR code is present, use scan_upi_qr_code tool (it will wait for QR to load)
6. Click the appropriate button to proceed to NEXT page
7. After page navigation, REPEAT from step 1 (analyze the NEW page)
8. When you think payment is complete, call check_payment_success tool
9. Continue until you reach success page or max attempts

IMPORTANT RULES:
- NEVER assume all fields are on the first page
- ALWAYS analyze_current_page BEFORE taking any action
- Use ONLY the fields visible on the CURRENT page
- After clicking submit/proceed, the page will change - analyze the NEW page
- Don't restart the flow - continue from wherever you are
- Payment data contains ALL details for ALL pages - use what's relevant for CURRENT page

PAYMENT GATEWAY vs PAYMENT METHOD:
CRITICAL: Understand the difference between these TWO separate selections:

1. PAYMENT GATEWAY SELECTION (comes FIRST):
   - This is the service provider that processes the payment
   - Examples: "Bill Desk", "City Union Bank", "Razorpay", "PayU", "CCAvenue"
   - Usually shown as radio buttons with images/logos
   - Use select_payment_option tool to select the gateway
   - Example: select_payment_option({ paymentMethodName: "Bill Desk" })
   - This happens BEFORE you see payment method options

2. PAYMENT METHOD SELECTION (comes AFTER gateway selection):
   - This is HOW you want to pay (appears on NEXT page after gateway selection)
   - Examples: "UPI", "Credit Card", "Debit Card", "Net Banking", "Wallet"
   - Only appears AFTER you've selected and proceeded with a payment gateway
   - If user mentions "QR code" or "scan QR":
     * Look for "UPI" or "QR Code" payment method option
     * Click it to reveal QR code
     * Use scan_upi_qr_code tool to extract QR URL
     * Use wait_for_payment tool (5 minutes)
   - If user mentions "UPI ID" or "enter UPI":
     * Look for "UPI" payment method option
     * Fill UPI ID field
     * Click Pay button
     * Use wait_for_payment tool (5 minutes)

WORKFLOW EXAMPLE:
Page 1: Fill account details → Click Proceed
Page 2: Select payment gateway (Bill Desk/City Union Bank) using select_payment_option → Click Proceed
Page 3: Select payment method (UPI/Card/etc.) → Complete payment
Page 4: Success confirmation

CRITICAL QR CODE WORKFLOW:
1. Click "Show QR" button
2. Call scan_upi_qr_code tool (REQUIRED - do not skip this!)
3. Call wait_for_payment tool
4. Done

PAYMENT WAITING:
- After QR scan OR after entering UPI ID and clicking Pay, you MUST use wait_for_payment tool
- wait_for_payment will:
  * Wait exactly 5 minutes without any navigation or page reload
  * Stay on the current page (page will automatically redirect to success if payment completes)
  * After 5 minutes, take ONE screenshot and check for success/failure
- Do NOT manually check for success - let wait_for_payment handle it
- Do NOT navigate or reload the page after initiating payment
- wait_for_payment will return success/failure/unclear status

CRITICAL: After wait_for_payment completes:
- If wait_for_payment returns success=true, IMMEDIATELY call check_payment_success tool
- This is MANDATORY to trigger cleanup and email notification
- Do NOT skip this step - the browser won't close and email won't send without it
- Example: wait_for_payment returns {"success": true} → NEXT STEP: call check_payment_success

DIALOG/POPUP HANDLING:
- Some websites show dialogs/popups after filling inputs or clicking buttons
- If you see a dialog message in console logs, use handle_dialog tool
- Dialog types: alert (info), confirm (yes/no), prompt (text input)
- Actions: 'accept' to confirm/OK, 'dismiss' to cancel
- For prompt dialogs, provide promptText parameter
- Example: handle_dialog with action="accept" to confirm a dialog

FORM RESUBMISSION HANDLING:
- Some websites (like BSES) may reload the form with empty fields after first submission
- This is normal behavior - it's a validation retry mechanism
- If you see the SAME form page again with empty fields and new CAPTCHA:
  * This means first submission failed (validation/session issue)
  * Simply re-fill the form fields again
  * Solve the new CAPTCHA
  * Click the button again
- Usually succeeds on 2nd attempt
- Don't give up - retry the form if you see it reload

EXAMPLE FLOW:
Page 1: See "CA Number" field → Fill it → Solve CAPTCHA → Fill it → Click "Proceed"
Page 2: See "Amount" field → Fill it → Click "Pay"  
Page 3: See QR code → Scan it → Return UPI link
Page 4: See "Payment Successful" → Done

Use tools to interact with the page. Adapt to what you see on each page.`;

  const messages = [
    new SystemMessage(systemPrompt),
    ...state.messages,
  ];

  const llmWithTools = llm!.bindTools(tools);
  
  try {
    const response = await llmWithTools.invoke(messages);
    return {
      messages: [response],
      paymentData: paymentData,
      targetUrl: targetUrl,
    };
  } catch (error: any) {
    console.error("Error in agent LLM call:", error);
    
    // Check if it's a rate limit or API error
    if (error.message && (error.message.includes('429') || error.message.includes('rate limit'))) {
      console.log("Rate limit error detected - closing browser...");
      try {
        if (browser) {
          await browser.close();
          console.log("Browser closed due to rate limit error");
        }
      } catch (cleanupError) {
        console.error("Error closing browser:", cleanupError);
      }
    }
    
    // Re-throw to fail the run
    throw error;
  }
}

async function toolNode(state: PaymentState) {
  await ensureInitialized(state.paymentData);
  
  // Check for timeout
  const sessionId = state.targetUrl;
  const elapsed = Date.now() - (paymentStartTime.get(sessionId) || Date.now());
  if (elapsed > PAYMENT_TIMEOUT_MS) {
    console.error('Payment flow timeout during tool execution');
    
    // Close browser on timeout
    try {
      console.log("Closing browser due to timeout...");
      await browser!.close();
      console.log("Browser closed after timeout");
    } catch (cleanupError) {
      console.error("Error closing browser on timeout:", cleanupError);
    }
    
    return {
      error: 'Payment flow timeout: 10 minutes exceeded',
      attemptCount: state.maxAttempts, // Force cleanup
    };
  }
  
  const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
  const toolCalls = lastMessage.tool_calls || [];

  const toolMessages = [];
  let waitForPaymentSuccess = false;
  
  for (const toolCall of toolCalls) {
    const tool = tools.find((t) => t.name === toolCall.name);
    if (tool) {
      try {
        const result = await tool.invoke(toolCall.args);
        toolMessages.push(
          new ToolMessage({
            content: result,
            tool_call_id: toolCall.id || "",
            name: toolCall.name,
          })
        );
        
        // Check if wait_for_payment returned success
        if (toolCall.name === 'wait_for_payment') {
          try {
            const parsedResult = JSON.parse(result);
            if (parsedResult.success === true) {
              console.log('wait_for_payment detected success - will trigger check_success');
              waitForPaymentSuccess = true;
            }
          } catch (parseError) {
            // Result not JSON or doesn't have success field
          }
        }
      } catch (error) {
        toolMessages.push(
          new ToolMessage({
            content: `Error executing ${toolCall.name}: ${error}`,
            tool_call_id: toolCall.id || "",
            name: toolCall.name,
          })
        );
      }
    }
  }

  const currentUrl = await browser!.getCurrentUrl();

  // If wait_for_payment detected success, automatically trigger check_success
  if (waitForPaymentSuccess) {
    console.log('Automatically triggering payment success check...');
    try {
      const screenshot = await browser!.captureScreenshot();
      const pageText = await browser!.getPageText();
      const isSuccess = await vision!.detectPaymentSuccess(screenshot, pageText);
      
      if (isSuccess) {
        console.log('Payment success confirmed by vision analysis');
        return {
          messages: toolMessages,
          currentUrl,
          attemptCount: state.attemptCount + 1,
          isPaymentComplete: true,
          confirmationDetails: pageText.substring(0, 500),
          screenshot,
        };
      } else {
        console.log('Vision analysis did not confirm payment success, continuing...');
      }
    } catch (error) {
      console.error('Error during automatic success check:', error);
    }
  }

  return {
    messages: toolMessages,
    currentUrl,
    attemptCount: state.attemptCount + 1,
  };
}

async function checkSuccessNode(_state: PaymentState) {
  await ensureInitialized();
  
  try {
    const screenshot = await browser!.captureScreenshot();
    const pageText = await browser!.getPageText();
    const isSuccess = await vision!.detectPaymentSuccess(screenshot, pageText);

    if (isSuccess) {
      return {
        isPaymentComplete: true,
        confirmationDetails: pageText.substring(0, 500),
      };
    }

    return {
      isPaymentComplete: false,
    };
  } catch (error) {
    return {
      error: `Failed to check success: ${error}`,
    };
  }
}

function shouldContinue(state: PaymentState): string {
  const lastMessage = state.messages[state.messages.length - 1];

  if (lastMessage && typeof lastMessage === "object" && "tool_calls" in lastMessage && (lastMessage.tool_calls as any[])?.length) {
    return "tools";
  }

  return END;
}

async function cleanupNode(state: PaymentState) {
  await ensureInitialized();
  
  console.log("Starting cleanup process...");
  
  // STEP 1: Send email notification if payment was successful
  // IMPORTANT: This happens BEFORE screenshot deletion to ensure the file exists
  if (state.isPaymentComplete) {
    try {
      console.log("Payment successful - preparing to send email notification...");
      
      // Get the last screenshot path (already saved to disk by checkSuccessNode)
      const screenshotPath = browser!.getLastScreenshotPath();
      
      if (!screenshotPath) {
        console.log("⚠ No screenshot available for email");
      } else {
        // Extract website name from URL
        const url = new URL(state.targetUrl);
        const websiteName = url.hostname.replace('www.', '');
        
        // Send email with payment success details
        // This reads the screenshot file from disk and sends it via Mailgun
        const emailService = new EmailService();
        const userEmail = state.paymentData?.email;
        const emailResult = await emailService.sendPaymentSuccessEmail(
          websiteName,
          screenshotPath,
          state.paymentData || {},
          userEmail
        );
        
        if (emailResult.success) {
          console.log("✓ Payment success email sent successfully");
        } else {
          console.log("⚠ Email notification skipped:", emailResult.message);
        }
      }
      
      // ALWAYS emit JSON status message with payment data (regardless of email status)
      const statusMessage = {
        status: "success",
        paymentData: state.paymentData || {}
      };
      console.log("\n=== PAYMENT SUCCESS ===");
      console.log(JSON.stringify(statusMessage, null, 2));
      console.log("======================\n");
      
    } catch (error) {
      console.error("Error in cleanup process:", error);
      
      // Still emit success message even if email fails
      const statusMessage = {
        status: "success",
        paymentData: state.paymentData || {},
        note: "Email sending failed but payment was successful"
      };
      console.log("\n=== PAYMENT SUCCESS ===");
      console.log(JSON.stringify(statusMessage, null, 2));
      console.log("======================\n");
    }
  }
  
  // STEP 2: Clear state and reset for next run
  const sessionId = state.targetUrl;
  paymentStartTime.delete(sessionId);
  
  currentPaymentData = null;
  console.log("Cleared payment data context");
  
  tools = [];
  console.log("Reset tools array");
  
  // STEP 3: Delete all screenshots (AFTER email has been sent)
  // Safe to delete now because email service has already read and sent the file
  try {
    const fs = await import('fs/promises');
    const path = await import('path');
    const screenshotsDir = path.join(process.cwd(), 'screenshots');
    
    const files = await fs.readdir(screenshotsDir);
    let deletedCount = 0;
    
    for (const file of files) {
      if (file.endsWith('.png') || file.endsWith('.jpg') || file.endsWith('.jpeg')) {
        await fs.unlink(path.join(screenshotsDir, file));
        deletedCount++;
      }
    }
    
    if (deletedCount > 0) {
      console.log(`Deleted ${deletedCount} screenshot(s)`);
    }
  } catch (error) {
    console.error("Error cleaning up screenshots:", error);
  }
  
  // Close browser
  try {
    console.log("Closing browser...");
    await browser!.close();
    browser = null;
    console.log("Browser closed successfully");
  } catch (error) {
    console.error("Error closing browser:", error);
  }
  
  // Reset vision analyzer
  vision = null;
  console.log("Reset vision analyzer");
  
  console.log("Cleanup process completed");

  return {
    messages: state.messages,
  };
}

function afterCheckSuccess(state: PaymentState): string {
  if (state.isPaymentComplete) {
    return "cleanup";
  }

  if (state.attemptCount >= state.maxAttempts) {
    return "cleanup";
  }

  return "agent";
}

function afterTools(state: PaymentState): string {
  // If payment is complete (set by toolNode when wait_for_payment succeeds), go to cleanup
  if (state.isPaymentComplete) {
    console.log("Routing to cleanup after tools (payment complete)");
    return "cleanup";
  }
  
  // If max attempts reached, go to cleanup
  if (state.attemptCount >= state.maxAttempts) {
    console.log("Routing to cleanup after tools (max attempts)");
    return "cleanup";
  }
  
  // Otherwise continue to agent
  return "agent";
}

const workflow = new StateGraph(PaymentStateAnnotation)
  .addNode("agent", agentNode)
  .addNode("tools", toolNode)
  .addNode("check_success", checkSuccessNode)
  .addNode("cleanup", cleanupNode)
  .addEdge(START, "agent")
  .addConditionalEdges("agent", shouldContinue)
  .addConditionalEdges("tools", afterTools)  // Changed from .addEdge to .addConditionalEdges
  .addConditionalEdges("check_success", afterCheckSuccess)
  .addEdge("cleanup", END);

/**
 * The compiled payment automation graph.
 * This graph can be invoked by LangGraph CLI or used programmatically.
 */
const compiledGraph = workflow.compile();

/**
 * Wrapped agent with error handling to ensure browser cleanup on exceptions
 * Clears all state before each run to ensure independence between payment runs
 */
const wrappedInvoke = async (input: any) => {
  // Debug: Log input paymentData
  console.log('🔍 wrappedInvoke called with input.paymentData:', JSON.stringify(input.paymentData));
  
  // Clear all agent state before starting a new run
  // This ensures no conflicting data or messages from previous runs
  await clearAgentState();
  
  try {
    return await compiledGraph.invoke(input);
  } catch (error) {
    console.error("Fatal error in payment flow:", error);
    
    // Ensure browser is closed on any exception
    try {
      await ensureInitialized();
      if (browser) {
        console.log("Closing browser due to fatal error...");
        await browser.close();
        console.log("Browser closed after error");
      }
    } catch (cleanupError) {
      console.error("Error during emergency cleanup:", cleanupError);
    }
    
    // Clear timeout tracker
    if (input.targetUrl) {
      paymentStartTime.delete(input.targetUrl);
    }
    
    // Re-throw the error
    throw error;
  }
};

// Export the compiled graph with wrapped invoke method
export const agent = Object.assign(compiledGraph, {
  invoke: wrappedInvoke,
});
