/**
 * Payment Agent - Local Server
 * 
 * This file provides a local HTTP server for testing the payment agent.
 * Run with: npm run server
 */

import "dotenv/config";
import http from "http";
import { agent } from "./agent.js";
import { HumanMessage } from "@langchain/core/messages";

const PORT = process.env.PORT || 3000;

console.log("🤖 Payment Agent Server\n");
console.log("💳 Generic Payment Automation Agent");
console.log("Features:");
console.log("  • Vision-based element detection");
console.log("  • Works across different payment websites");
console.log("  • ReAct pattern (Reason → Act → Observe)");
console.log("  • Automatic retry logic");
console.log("  • Payment success detection\n");

const server = http.createServer(async (req, res) => {
  // Enable CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // Handle preflight
  if (req.method === "OPTIONS") {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check endpoint
  if (req.url === "/health" && req.method === "GET") {
    const healthStatus = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      service: "Payment Agent",
      version: "1.0.0",
      environment: process.env.NODE_ENV || "development",
      features: {
        emailNotifications: !!(
          process.env.MAILGUN_API_KEY && process.env.MAILGUN_DOMAIN
        ),
        pushNotifications: !!(
          process.env.PAYMENT_NOTIFICATION_URL && process.env.SUPABASE_ANON_KEY
        ),
        groqApi: !!process.env.GROQ_API_KEY,
      },
    };

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(healthStatus, null, 2));
    return;
  }

  // Payment processing endpoint
  if (req.url === "/payment" && req.method === "POST") {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk.toString();
    });

    req.on("end", async () => {
      try {
        const requestBody = JSON.parse(body);
        const streamMode = requestBody.stream_mode || [];
        const shouldStream = streamMode.includes('values') || streamMode.includes('updates');

        // Support two formats:
        // Format 1: Natural language prompt (array or string)
        // Format 2: Structured { paymentData, targetUrl }
        
        let messageContent: string;
        let paymentData: any = {};
        let targetUrl: string = "";

        // Check if it's a natural language prompt (array or string in 'prompt' or 'message' field)
        if (requestBody.prompt || requestBody.message || requestBody.input?.messages) {
          // Handle LangGraph format: { input: { messages: [...] } }
          if (requestBody.input?.messages) {
            const messages = requestBody.input.messages;
            messageContent = messages.map((m: any) => m.content).join("\n");
          } else {
            const promptData = requestBody.prompt || requestBody.message;
            
            // Handle array format (like your example)
            if (Array.isArray(promptData)) {
              messageContent = promptData.join('\n');
            } else {
              messageContent = promptData;
            }
          }
          
          console.log("\n📥 Received natural language prompt:");
          console.log(messageContent.substring(0, 500) + (messageContent.length > 500 ? '...' : ''));
          console.log("\n⏳ Processing payment with prompt...\n");
          console.log("Streaming:", shouldStream);

          const initialState = {
            messages: [new HumanMessage(messageContent)],
            paymentData: {} as any, // Empty - will be extracted from prompt
            targetUrl: "", // Empty - will be extracted from prompt
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
            res.writeHead(200, {
              'Content-Type': 'text/event-stream',
              'Cache-Control': 'no-cache',
              'Connection': 'keep-alive',
              'Access-Control-Allow-Origin': '*',
            });

            try {
              // Stream agent execution
              const stream = await agent.stream(initialState as any, {
                recursionLimit: 150,
              });
              
              for await (const chunk of stream) {
                const eventData = JSON.stringify(chunk);
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
          const result = await agent.invoke(initialState as any, {
            recursionLimit: 150,
          });

          if (result.isPaymentComplete) {
            console.log("\n✅ Payment Successful!");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: true,
                details:
                  result.confirmationDetails || "Payment completed successfully",
                attempts: result.attemptCount,
              })
            );
          } else {
            console.log("\n❌ Payment Failed");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: false,
                details: result.error || "Payment failed - max attempts reached",
                attempts: result.attemptCount,
              })
            );
          }
          return;
        }

        // Format 2: Structured paymentData and targetUrl
        paymentData = requestBody.paymentData;
        targetUrl = requestBody.targetUrl;

        if (!paymentData || !targetUrl) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Missing required fields",
              message: "Provide either 'prompt' (natural language) or both 'paymentData' and 'targetUrl' (structured)",
              examples: {
                naturalLanguage: {
                  prompt: ["Pay bill...", "Steps:", "1. Navigate to...", "..."]
                },
                structured: {
                  paymentData: { paymentType: "...", amount: "..." },
                  targetUrl: "https://..."
                }
              }
            })
          );
          return;
        }

        console.log("\n📥 Received structured payment request:");
        console.log("Payment Data:", JSON.stringify(paymentData, null, 2));
        console.log("Target URL:", targetUrl);
        console.log("\n⏳ Processing payment...\n");
        console.log("Streaming:", shouldStream);

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
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*',
          });

          try {
            const stream = await agent.stream(initialState as any, {
              recursionLimit: 150,
            });
            
            for await (const chunk of stream) {
              const eventData = JSON.stringify(chunk);
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
        const result = await agent.invoke(initialState as any, {
          recursionLimit: 150,
        });

        if (result.isPaymentComplete) {
          console.log("\n✅ Payment Successful!");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: true,
              details:
                result.confirmationDetails || "Payment completed successfully",
              attempts: result.attemptCount,
            })
          );
        } else {
          console.log("\n❌ Payment Failed");
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              success: false,
              details: result.error || "Payment failed - max attempts reached",
              attempts: result.attemptCount,
            })
          );
        }
      } catch (error: any) {
        console.error("\n💥 Error:", error);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            error: "Internal server error",
            message: error.message,
          })
        );
      }
    });

    return;
  }

  // 404 for other routes
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      error: "Not found",
      availableEndpoints: {
        health: "GET /health",
        payment: "POST /payment",
      },
    })
  );
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`\n📡 Available endpoints:`);
  console.log(`   GET  http://localhost:${PORT}/health`);
  console.log(`   POST http://localhost:${PORT}/payment`);
  console.log(`\n💡 Example request:`);
  console.log(`   curl -X POST http://localhost:${PORT}/payment \\`);
  console.log(`     -H "Content-Type: application/json" \\`);
  console.log(`     -d '{"paymentData": {...}, "targetUrl": "..."}'`);
  console.log(`\n⌨️  Press Ctrl+C to stop the server\n`);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n🛑 Shutting down server...");
  server.close(() => {
    console.log("✅ Server stopped");
    process.exit(0);
  });
});

process.on("SIGTERM", () => {
  console.log("\n\n🛑 Shutting down server...");
  server.close(() => {
    console.log("✅ Server stopped");
    process.exit(0);
  });
});
