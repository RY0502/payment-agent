import { StateGraph, END, START, Annotation } from "@langchain/langgraph";
import {
  FreeTierOrchestrator,
  createTextProviders,
  type Provider,
  type LlmInput,
} from "@freetier/orchestrator";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { BrowserManager } from "./browser.js";
import { VisionAnalyzer } from "./vision.js";
import { createPaymentTools } from "./payment-tools.js";
import { PaymentData } from "./types.js";

const MAX_ATTEMPTS_PER_STEP = 5;

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
  screenshot: Annotation<string>({
    reducer: (left, right) => right || left,
    default: () => "",
  }),
  accessibilityTree: Annotation<string>({
    reducer: (left, right) => right || left,
    default: () => "",
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
  nextAction: Annotation<string>({
    reducer: (left, right) => right || left,
    default: () => "",
  }),
});

type PaymentState = typeof PaymentStateAnnotation.State;

const TEXT_PROVIDER_PRIORITY = ["Cloudflare", "Groq", "NVIDIA", "Cerebras", "HuggingFace", "SambaNova"];

function buildTextOrchestrator(): FreeTierOrchestrator<LlmInput, string> {
  const providers: Provider<LlmInput, string>[] = createTextProviders();
  const ordered = [...providers].sort((a, b) => {
    const rankA = TEXT_PROVIDER_PRIORITY.indexOf(a.name);
    const rankB = TEXT_PROVIDER_PRIORITY.indexOf(b.name);
    return (rankA === -1 ? TEXT_PROVIDER_PRIORITY.length : rankA) - (rankB === -1 ? TEXT_PROVIDER_PRIORITY.length : rankB);
  });
  return new FreeTierOrchestrator<LlmInput, string>(ordered);
}

function formatToolsDocumentation(toolsList: any[]): string {
  const descriptions: Record<string, string> = {
    navigate_to_website: `navigate_to_website({ "url": "https://example.com" }) - Navigate to URL`,
    analyze_current_page: `analyze_current_page({ "paymentData": { ... }, "currentStep": "step description" }) - Analyze page with vision AI to detect visible fields, buttons, and CAPTCHA`,
    fill_form_field: `fill_form_field({ "fieldDescription": "field name or placeholder", "value": "value to type" }) - Fill a form field by description`,
    click_button: `click_button({ "buttonDescription": "button text" }) - Click a button by description`,
    select_dropdown_option: `select_dropdown_option({ "dropdownDescription": "dropdown name", "optionText": "option to choose" }) - Select from dropdown`,
    select_payment_option: `select_payment_option({ "paymentMethodName": "BillDesk|UPI|GooglePay|QR|etc" }) - Select payment gateway, payment tab, or payment method`,
    check_payment_success: `check_payment_success({}) - Verify if payment succeeded (MANDATORY after successful wait_for_payment)`,
    get_current_page_info: `get_current_page_info({}) - Get current page details (URL, title, text)`,
    list_clickable_elements: `list_clickable_elements({}) - List all visible clickable buttons/links`,
    solve_captcha: `solve_captcha({}) - Read and return CAPTCHA text using vision AI`,
    handle_dialog: `handle_dialog({ "action": "accept"|"dismiss", "promptText": "text" }) - Accept or dismiss browser popup dialog`,
    wait_for_payment: `wait_for_payment({}) - Wait 5 minutes for payment completion after QR scan or UPI submit`,
    scan_upi_qr_code: `scan_upi_qr_code({}) - Extract QR code image URL from payment page`
  };

  return toolsList.map(t => descriptions[t.name] || `${t.name} - ${t.description || "Execute " + t.name}`).join('\n');
}

function formatConversationHistory(messages: any[]): string {
  const lines: string[] = [];
  
  for (const msg of messages) {
    if (typeof msg === 'string') {
      lines.push(`User: ${msg}`);
    } else if (msg && typeof msg === 'object') {
      const type = msg._getType ? msg._getType() : (msg.constructor?.name || msg.role || 'message');
      const content = typeof msg.content === 'string' ? msg.content : (Array.isArray(msg.content) ? msg.content.join('\n') : JSON.stringify(msg.content));
      
      if (type === 'human' || type === 'HumanMessage' || msg.role === 'user' || msg.role === 'human') {
        lines.push(`User:\n${content}`);
      } else if (type === 'ai' || type === 'AIMessage' || msg.role === 'assistant') {
        let text = `Assistant Thought: ${content || 'Deciding next action'}`;
        if (msg.tool_calls && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
          const calls = msg.tool_calls.map((tc: any) => 
            `Tool Action: ${tc.name}(${JSON.stringify(tc.args || {})})`
          ).join('\n');
          text += `\n${calls}`;
        }
        lines.push(text);
      } else if (type === 'tool' || type === 'ToolMessage' || msg.role === 'tool') {
        const name = msg.name || 'tool';
        lines.push(`Observation (${name}):\n${content}`);
      } else if (type !== 'system' && type !== 'SystemMessage') {
        lines.push(`${type}: ${content}`);
      }
    }
  }
  
  return lines.join('\n\n');
}

function parseModelToolResponse(responseText: string): { thought: string; toolCalls: Array<{ id: string; name: string; args: any }>; finalResponse?: string } {
  let cleanText = responseText.trim();
  
  const jsonBlockMatch = cleanText.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonBlockMatch) {
    cleanText = jsonBlockMatch[1].trim();
  }
  
  const jsonMatch = cleanText.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        const toolName = parsed.tool || parsed.name || parsed.tool_name || parsed.action || parsed.tool_call?.name;
        let toolArgs = parsed.args || parsed.arguments || parsed.parameters || parsed.tool_call?.args || {};
        
        if (typeof toolArgs === 'string') {
          try {
            toolArgs = JSON.parse(toolArgs);
          } catch (_parseErr) {
            // Keep toolArgs as string if not valid JSON
          }
        }
        
        const thought = parsed.thought || parsed.reasoning || parsed.explanation || (toolName ? `Executing ${toolName}` : cleanText);
        
        if (toolName && typeof toolName === 'string') {
          const toolCallId = `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
          return {
            thought,
            toolCalls: [{
              id: toolCallId,
              name: toolName.trim(),
              args: typeof toolArgs === 'object' && toolArgs !== null ? toolArgs : {},
            }],
          };
        }
        
        if (Array.isArray(parsed.tools)) {
          const toolCalls = parsed.tools.map((t: any) => ({
            id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            name: (t.tool || t.name || '').trim(),
            args: t.args || t.arguments || {},
          })).filter((tc: any) => tc.name);
          
          if (toolCalls.length > 0) {
            return { thought, toolCalls };
          }
        }
        
        return {
          thought,
          toolCalls: [],
          finalResponse: parsed.finalResponse || parsed.message || parsed.response || thought,
        };
      }
      
      if (Array.isArray(parsed)) {
        const toolCalls = parsed.map((t: any) => ({
          id: `call_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          name: (t.tool || t.name || '').trim(),
          args: t.args || t.arguments || {},
        })).filter((tc: any) => tc.name);
        
        return {
          thought: toolCalls.length > 0 ? `Executing ${toolCalls.map(t => t.name).join(', ')}` : cleanText,
          toolCalls,
        };
      }
    } catch (parseError) {
      console.warn("Could not parse JSON from model output, falling back to plain text:", parseError);
    }
  }
  
  return {
    thought: cleanText,
    toolCalls: [],
    finalResponse: cleanText,
  };
}

export class PaymentReActAgent {
  private browser: BrowserManager;
  private vision: VisionAnalyzer;
  private textOrchestrator: FreeTierOrchestrator<LlmInput, string>;
  private tools: any[];
  private graph: any;

  constructor(_apiKey?: string) {
    this.browser = new BrowserManager();
    this.vision = new VisionAnalyzer();
    this.textOrchestrator = buildTextOrchestrator();
    this.tools = createPaymentTools(this.browser, this.vision);
    this.graph = this.buildGraph();
  }

  private buildGraph() {
    const workflow = new StateGraph(PaymentStateAnnotation)
      .addNode("agent", this.agentNode.bind(this))
      .addNode("tools", this.toolNode.bind(this))
      .addNode("check_success", this.checkSuccessNode.bind(this))
      .addEdge(START, "agent")
      .addConditionalEdges("agent", this.shouldContinue.bind(this))
      .addEdge("tools", "check_success")
      .addConditionalEdges("check_success", this.afterCheckSuccess.bind(this));

    return workflow.compile();
  }

  private async agentNode(state: PaymentState) {
    const systemPrompt = `You are a ReAct payment automation agent. Your goal is to complete a payment on a website using the provided payment data.

PAYMENT DATA:
${JSON.stringify(state.paymentData, null, 2)}

TARGET URL: ${state.targetUrl}
CURRENT STEP: ${state.currentStep}
ATTEMPT: ${state.attemptCount + 1}/${state.maxAttempts}

AVAILABLE TOOLS:
${formatToolsDocumentation(this.tools)}

RESPONSE FORMAT INSTRUCTIONS:
You MUST respond with valid JSON in one of these two formats:

Format 1 - To execute a tool action:
{
  "thought": "Reasoning about what to do next based on the observation",
  "tool": "tool_name",
  "args": { ... }
}

Format 2 - When payment is completed or no further action needed:
{
  "thought": "Reasoning about completion",
  "finalResponse": "Payment completed successfully / Summary"
}

INSTRUCTIONS:
- Think step by step (ReAct pattern: Reason -> Act -> Observe)
- First analyze the page to understand what's visible
- Then take appropriate actions based on the payment data
- Always verify actions were successful
- If you encounter errors, try alternative approaches
- Continue until you reach a payment success page

Current attempt: ${state.attemptCount + 1}/${state.maxAttempts}`;

    const conversationHistory = formatConversationHistory(state.messages);
    const agentPrompt = `CONVERSATION HISTORY AND CURRENT STATE:\n${conversationHistory}\n\nDetermine your next action. Respond with JSON:`;

    const responseText = await this.textOrchestrator.invoke({
      system: systemPrompt,
      prompt: agentPrompt,
    });

    const { thought, toolCalls, finalResponse } = parseModelToolResponse(responseText);

    const aiResponse = new AIMessage({
      content: toolCalls.length > 0 ? thought : (finalResponse || thought),
      tool_calls: toolCalls,
    });

    return {
      messages: [aiResponse],
    };
  }

  private async toolNode(state: PaymentState) {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;
    const toolCalls = lastMessage.tool_calls || [];

    const toolMessages = [];
    for (const toolCall of toolCalls) {
      const tool = this.tools.find((t) => t.name === toolCall.name);
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

    const currentUrl = await this.browser.getCurrentUrl();

    return {
      messages: toolMessages,
      currentUrl,
      attemptCount: state.attemptCount + 1,
    };
  }

  private async checkSuccessNode(_state: PaymentState) {
    try {
      const screenshot = await this.browser.captureScreenshot();
      const pageText = await this.browser.getPageText();
      const isSuccess = await this.vision.detectPaymentSuccess(screenshot, pageText);

      if (isSuccess) {
        return {
          isPaymentComplete: true,
          confirmationDetails: pageText.substring(0, 500),
          screenshot,
        };
      }

      return {
        isPaymentComplete: false,
        screenshot,
      };
    } catch (error) {
      return {
        error: `Failed to check success: ${error}`,
      };
    }
  }

  private shouldContinue(state: PaymentState): string {
    const lastMessage = state.messages[state.messages.length - 1];

    if (lastMessage && "tool_calls" in lastMessage && (lastMessage.tool_calls as any[])?.length) {
      return "tools";
    }

    return END;
  }

  private afterCheckSuccess(state: PaymentState): string {
    if (state.isPaymentComplete) {
      return END;
    }

    if (state.attemptCount >= state.maxAttempts) {
      return END;
    }

    return "agent";
  }

  async executePayment(
    paymentData: any,
    targetUrl: string
  ): Promise<{ success: boolean; details: string; attempts: number }> {
    await this.browser.initialize();

    try {
      const initialState = {
        messages: [
          new HumanMessage(
            `Complete the payment on ${targetUrl} using the provided payment data. Start by navigating to the website and analyzing the page.`
          ),
        ],
        paymentData,
        targetUrl,
        currentUrl: "",
        currentStep: "initial",
        attemptCount: 0,
        maxAttempts: MAX_ATTEMPTS_PER_STEP,
        isPaymentComplete: false,
      };

      const result = await this.graph.invoke(initialState, {
        recursionLimit: 150,
      });

      if (result.isPaymentComplete) {
        return {
          success: true,
          details: result.confirmationDetails || "Payment completed successfully",
          attempts: result.attemptCount,
        };
      }

      return {
        success: false,
        details: result.error || "Payment failed - max attempts reached",
        attempts: result.attemptCount,
      };
    } catch (error) {
      return {
        success: false,
        details: `Payment failed with error: ${error}`,
        attempts: 0,
      };
    } finally {
      await this.browser.close();
    }
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}
