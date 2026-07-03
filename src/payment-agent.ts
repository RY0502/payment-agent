import { StateGraph, END, START, Annotation } from "@langchain/langgraph";
import { ChatGroq } from "@langchain/groq";
import { HumanMessage, AIMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
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

export class PaymentReActAgent {
  private browser: BrowserManager;
  private vision: VisionAnalyzer;
  private llm: ChatGroq;
  private tools: any[];
  private graph: any;

  constructor(groqApiKey: string) {
    this.browser = new BrowserManager();
    this.vision = new VisionAnalyzer();
    this.llm = new ChatGroq({
      apiKey: groqApiKey,
      model: "llama-3.3-70b-versatile",
      temperature: 0.1,
    });
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

Available tools:
1. navigate_to_website - Navigate to a URL
2. analyze_current_page - Analyze the page with vision AI
3. fill_form_field - Fill a form field by description
4. click_button - Click a button by description
5. select_dropdown_option - Select from dropdown
6. check_payment_success - Check if payment succeeded
7. get_current_page_info - Get current page details

INSTRUCTIONS:
- Think step by step (ReAct pattern: Reason -> Act -> Observe)
- First analyze the page to understand what's visible
- Then take appropriate actions based on the payment data
- Always verify actions were successful
- If you encounter errors, try alternative approaches
- Continue until you reach a payment success page

Current attempt: ${state.attemptCount + 1}/${state.maxAttempts}

Respond with your reasoning and the tool you want to use.`;

    const messages = [
      new SystemMessage(systemPrompt),
      ...state.messages,
    ];

    const llmWithTools = this.llm.bindTools(this.tools);
    const response = await llmWithTools.invoke(messages);

    return {
      messages: [response],
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

      const result = await this.graph.invoke(initialState);

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
