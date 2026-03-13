import { BaseMessage } from "@langchain/core/messages";

export interface PaymentData {
  paymentType: string;
  accountNumber?: string;
  amount?: string;
  currency?: string;
  dueDate?: string;
  customerName?: string;
  mobileNumber?: string;
  email?: string;
  [key: string]: string | undefined;
}

export interface PaymentAgentState {
  messages: BaseMessage[];
  paymentData: PaymentData;
  targetUrl: string;
  currentUrl: string;
  currentStep: string;
  attemptCount: number;
  maxAttempts: number;
  screenshot?: string;
  accessibilityTree?: string;
  isPaymentComplete: boolean;
  confirmationDetails?: string;
  error?: string;
  nextAction?: string;
}

export interface ElementLocation {
  selector?: string;
  coordinates?: { x: number; y: number };
  description: string;
  confidence: number;
}

export interface VisionAnalysisResult {
  pageType: string;
  identifiedElements: Array<{
    type: string;
    label: string;
    location: ElementLocation;
  }>;
  suggestedAction: string;
  isPaymentSuccessPage: boolean;
  reasoning: string;
  hasCaptcha?: boolean;
}
