/**
 * Payment Agent - Entry Point
 *
 * This file provides a CLI interface for testing the payment agent.
 * Run with: npm start
 */

import "dotenv/config";
import { agent } from "./agent.js";
import { HumanMessage } from "@langchain/core/messages";

console.log("🤖 Payment Agent Started\n");
console.log("💳 Generic Payment Automation Agent");
console.log("Features:");
console.log("  • Vision-based element detection");
console.log("  • Works across different payment websites");
console.log("  • ReAct pattern (Reason → Act → Observe)");
console.log("  • Automatic retry logic (5 attempts per step)");
console.log("  • Payment success detection\n");

const paymentData = {
  paymentType: "electricity",
  accountNumber: "123456789",
  amount: "150",
  currency: "USD",
  customerName: "John Doe",
  email: "john@example.com",
  mobileNumber: "1234567890",
};

const targetUrl = "https://example-electricity-payment.com";

console.log("💳 Payment Data:");
console.log(JSON.stringify(paymentData, null, 2));
console.log("\n🌐 Target URL:", targetUrl);
console.log("\n⏳ Starting payment process...\n");

try {
  const result = await agent.invoke({
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
    maxAttempts: 5,
    isPaymentComplete: false,
    confirmationDetails: "",
    error: "",
  });

  if (result.isPaymentComplete) {
    console.log("\n✅ Payment Successful!");
    console.log("📋 Details:", result.confirmationDetails || "Payment completed successfully");
    console.log("🔄 Attempts:", result.attemptCount);
  } else {
    console.log("\n❌ Payment Failed");
    console.log("📋 Details:", result.error || "Payment failed - max attempts reached");
    console.log("🔄 Attempts:", result.attemptCount);
  }
} catch (error) {
  console.error("\n💥 Error:", error);
}
