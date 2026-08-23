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
    const requestBody = req.body;
    const streamMode = requestBody.stream_mode || [];
    const shouldStream = streamMode.includes('values') || streamMode.includes('updates');

    // Support two formats:
    // Format 1: Natural language prompt
    // Format 2: Structured { paymentData, targetUrl }

    let messageContent: string;
    let paymentData: any = {};
    let targetUrl: string = "";

    // Check if it's a natural language prompt
    if (requestBody.prompt || requestBody.message || requestBody.input?.messages) {
      // Handle LangGraph format: { input: { messages: [...] } }
      if (requestBody.input?.messages) {
        const messages = requestBody.input.messages;
        messageContent = messages.map((m: any) => m.content).join("\n");
      } else {
        const promptData = requestBody.prompt || requestBody.message;
        // Handle array format
        if (Array.isArray(promptData)) {
          messageContent = promptData.join("\n");
        } else {
          messageContent = promptData;
        }
      }

      console.log("\n📥 Received natural language prompt:");
      console.log(messageContent.substring(0, 500));
      console.log("\n⏳ Processing payment with prompt...\n");
      console.log("Streaming:", shouldStream);

      // Import agent and use it
      const { agent } = await import("../dist/agent.js");
      const { HumanMessage } = await import("@langchain/core/messages");

      const initialState = {
        messages: [new HumanMessage(messageContent)],
        paymentData: {},
        targetUrl: "",
        currentUrl: "",
        currentStep: "initial",
        attemptCount: 0,
        maxAttempts: 50,
        isPaymentComplete: false,
        confirmationDetails: "",
        error: "",
      };

      // SSE Streaming mode
      if (shouldStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        try {
          // Get stream mode from request (default to 'values')
          const streamMode = requestBody.stream_mode || ['values'];
          const config = requestBody.config || {};
          
          // Stream agent execution with proper stream mode
          const stream = await agent.stream(initialState, {
            ...config,
            streamMode: streamMode[0] || 'values',
          });
          
          for await (const chunk of stream) {
            // Format: { event: 'values', data: {...state} }
            const eventData = JSON.stringify({ 
              event: streamMode[0] || 'values',
              data: chunk 
            });
            res.write(`event: data\n`);
            res.write(`data: ${eventData}\n\n`);
          }

          res.write('event: end\n');
          res.write('data: {}\n\n');
          res.end();
        } catch (streamError: any) {
          console.error("Streaming error:", streamError);
          res.write(`event: error\n`);
          res.write(`data: ${JSON.stringify({ error: streamError.message })}\n\n`);
          res.end();
        }
        return;
      }

      // Non-streaming mode (original behavior)
      const result = await agent.invoke(initialState);

      if (result.isPaymentComplete) {
        console.log("\n✅ Payment Successful!");
        return res.status(200).json({
          success: true,
          details:
            result.confirmationDetails || "Payment completed successfully",
          attempts: result.attemptCount,
        });
      } else {
        console.log("\n❌ Payment Failed");
        return res.status(200).json({
          success: false,
          details: result.error || "Payment failed - max attempts reached",
          attempts: result.attemptCount,
        });
      }
    }

    // Format 2: Structured paymentData and targetUrl
    paymentData = requestBody.paymentData;
    targetUrl = requestBody.targetUrl;

    if (!paymentData || !targetUrl) {
      return res.status(400).json({
        error: "Missing required fields",
        message:
          "Provide either 'prompt' (natural language) or both 'paymentData' and 'targetUrl' (structured)",
        examples: {
          naturalLanguage: {
            prompt: ["Pay bill...", "Steps:", "1. Navigate to...", "..."],
          },
          structured: {
            paymentData: { paymentType: "...", amount: "..." },
            targetUrl: "https://...",
          },
        },
      });
    }

    console.log("\n📥 Received structured payment request:");
    console.log("Payment Data:", JSON.stringify(paymentData, null, 2));
    console.log("Target URL:", targetUrl);
    console.log("\n⏳ Processing payment...\n");
    console.log("Streaming:", shouldStream);

    // Import agent and use it
    const { agent } = await import("../dist/agent.js");
    const { HumanMessage } = await import("@langchain/core/messages");

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
      maxAttempts: 50,
      isPaymentComplete: false,
      confirmationDetails: "",
      error: "",
    };

    // SSE Streaming mode
    if (shouldStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');

      try {
        // Get stream mode from request (default to 'values')
        const streamMode = requestBody.stream_mode || ['values'];
        const config = requestBody.config || {};
        
        // Stream agent execution with proper stream mode
        const stream = await agent.stream(initialState, {
          ...config,
          streamMode: streamMode[0] || 'values',
        });
        
        for await (const chunk of stream) {
          // Format: { event: 'values', data: {...state} }
          const eventData = JSON.stringify({ 
            event: streamMode[0] || 'values',
            data: chunk 
          });
          res.write(`event: data\n`);
          res.write(`data: ${eventData}\n\n`);
        }

        res.write('event: end\n');
        res.write('data: {}\n\n');
        res.end();
      } catch (streamError: any) {
        console.error("Streaming error:", streamError);
        res.write(`event: error\n`);
        res.write(`data: ${JSON.stringify({ error: streamError.message })}\n\n`);
        res.end();
      }
      return;
    }

    // Non-streaming mode
    const result = await agent.invoke(initialState);

    if (result.isPaymentComplete) {
      console.log("\n✅ Payment Successful!");
      return res.status(200).json({
        success: true,
        details:
          result.confirmationDetails || "Payment completed successfully",
        attempts: result.attemptCount,
      });
    } else {
      console.log("\n❌ Payment Failed");
      return res.status(200).json({
        success: false,
        details: result.error || "Payment failed - max attempts reached",
        attempts: result.attemptCount,
      });
    }
  } catch (error: any) {
    console.error("Payment API error:", error);
    return res.status(500).json({
      error: "Internal server error",
      message: error.message,
    });
  }
}
