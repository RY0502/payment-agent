import type { VercelRequest, VercelResponse } from "@vercel/node";

export const config = {
  maxDuration: 300,
  memory: 1024,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed. Use POST." });
  }

  try {
    const { paymentData, targetUrl } = req.body;

    if (!paymentData || !targetUrl) {
      return res.status(400).json({
        error: "Missing required fields",
        required: ["paymentData", "targetUrl"],
      });
    }

    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) {
      return res.status(500).json({
        error: "Server configuration error: GROQ_API_KEY not set",
      });
    }

    const { StateGraph, START, END, Annotation } =
      await import("@langchain/langgraph");
    const { ChatGroq } = await import("@langchain/groq");
    const { SystemMessage, ToolMessage, HumanMessage } =
      await import("@langchain/core/messages");
    const { BrowserManager } = await import("../dist/browser.js");
    const { VisionAnalyzer } = await import("../dist/vision.js");
    const { createPaymentTools } = await import("../dist/payment-tools.js");

    const MAX_ATTEMPTS_PER_STEP = 3;

    const PaymentStateAnnotation = Annotation.Root({
      messages: Annotation({
        reducer: (left: any[], right: any[]) => left.concat(right),
        default: () => [],
      }),
      paymentData: Annotation({
        reducer: (left: any, right: any) => right || left,
        default: () => ({ paymentType: "" }),
      }),
      targetUrl: Annotation({
        reducer: (left: string, right: string) => right || left,
        default: () => "",
      }),
      currentUrl: Annotation({
        reducer: (left: string, right: string) => right || left,
        default: () => "",
      }),
      currentStep: Annotation({
        reducer: (left: string, right: string) => right || left,
        default: () => "initial",
      }),
      attemptCount: Annotation({
        reducer: (left: number, right: number) =>
          right !== undefined ? right : left,
        default: () => 0,
      }),
      maxAttempts: Annotation({
        reducer: (left: number, right: number) => right || left,
        default: () => MAX_ATTEMPTS_PER_STEP,
      }),
      isPaymentComplete: Annotation({
        reducer: (left: boolean, right: boolean) =>
          right !== undefined ? right : left,
        default: () => false,
      }),
      confirmationDetails: Annotation({
        reducer: (left: string, right: string) => right || left,
        default: () => "",
      }),
      error: Annotation({
        reducer: (left: string, right: string) => right || left,
        default: () => "",
      }),
    });

    const browser = new BrowserManager();
    const vision = new VisionAnalyzer(groqApiKey);
    const llm = new ChatGroq({
      apiKey: groqApiKey,
      model: "llama-3.3-70b-versatile",
      temperature: 0.1,
    });
    const tools = createPaymentTools(browser, vision);

    const agentNode = async (state: any) => {
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

      const messages = [new SystemMessage(systemPrompt), ...state.messages];

      const llmWithTools = llm.bindTools(tools);
      const response = await llmWithTools.invoke(messages);

      return {
        messages: [response],
      };
    };

    const toolNode = async (state: any) => {
      const lastMessage = state.messages[state.messages.length - 1];
      const toolCalls = lastMessage.tool_calls || [];

      const toolMessages = [];
      for (const toolCall of toolCalls) {
        const tool = tools.find((t: any) => t.name === toolCall.name);
        if (tool) {
          try {
            const result = await tool.invoke(toolCall.args);
            toolMessages.push(
              new ToolMessage({
                content: result,
                tool_call_id: toolCall.id || "",
                name: toolCall.name,
              }),
            );
          } catch (error) {
            toolMessages.push(
              new ToolMessage({
                content: `Error executing ${toolCall.name}: ${error}`,
                tool_call_id: toolCall.id || "",
                name: toolCall.name,
              }),
            );
          }
        }
      }

      const currentUrl = await browser.getCurrentUrl();

      return {
        messages: toolMessages,
        currentUrl,
        attemptCount: state.attemptCount + 1,
      };
    };

    const checkSuccessNode = async (_state: any) => {
      try {
        const screenshot = await browser.captureScreenshot();
        const pageText = await browser.getPageText();
        const isSuccess = await vision.detectPaymentSuccess(
          screenshot,
          pageText,
        );

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
    };

    const shouldContinue = (state: any): string => {
      const lastMessage = state.messages[state.messages.length - 1];

      if (
        lastMessage &&
        "tool_calls" in lastMessage &&
        (lastMessage.tool_calls as any[])?.length
      ) {
        return "tools";
      }

      return END;
    };

    const afterCheckSuccess = (state: any): string => {
      if (state.isPaymentComplete) {
        return END;
      }

      if (state.attemptCount >= state.maxAttempts) {
        return END;
      }

      return "agent";
    };

    const workflow = new StateGraph(PaymentStateAnnotation)
      .addNode("agent", agentNode)
      .addNode("tools", toolNode)
      .addNode("check_success", checkSuccessNode)
      .addEdge(START, "agent")
      .addConditionalEdges("agent", shouldContinue)
      .addEdge("tools", "check_success")
      .addConditionalEdges("check_success", afterCheckSuccess);

    const graph = workflow.compile();

    await browser.initialize();

    try {
      const initialState = {
        messages: [
          new HumanMessage(
            `Complete the payment on ${targetUrl} using the provided payment data. Start by navigating to the website and analyzing the page.`,
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

      const result = await graph.invoke(initialState);

      if (result.isPaymentComplete) {
        return res.status(200).json({
          success: true,
          details:
            result.confirmationDetails || "Payment completed successfully",
          attempts: result.attemptCount,
        });
      }

      return res.status(200).json({
        success: false,
        details: result.error || "Payment failed - max attempts reached",
        attempts: result.attemptCount,
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        details: `Payment failed with error: ${error.message}`,
        attempts: 0,
      });
    } finally {
      await browser.close();
    }
  } catch (error: any) {
    console.error("Payment API error:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
}
