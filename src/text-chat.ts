import { ChatGroq } from "@langchain/groq";
import {
  FreeTierOrchestrator,
  createTextProviders,
  type LlmInput,
  type Provider,
} from "@freetier/orchestrator";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

const TEXT_PROVIDER_PRIORITY = ["Cloudflare", "Groq", "NVIDIA", "Cerebras", "HuggingFace", "SambaNova"];

function buildTextOrchestrator(): FreeTierOrchestrator<LlmInput, string> {
  const providers: Provider<LlmInput, string>[] = createTextProviders();
  const ordered = [...providers].sort((left, right) => {
    const leftRank = TEXT_PROVIDER_PRIORITY.indexOf(left.name);
    const rightRank = TEXT_PROVIDER_PRIORITY.indexOf(right.name);
    return (leftRank === -1 ? TEXT_PROVIDER_PRIORITY.length : leftRank) -
      (rightRank === -1 ? TEXT_PROVIDER_PRIORITY.length : rightRank);
  });
  return new FreeTierOrchestrator<LlmInput, string>(ordered);
}

function messageContentToText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => typeof part === "string" ? part : JSON.stringify(part))
      .join("\n");
  }

  return content == null ? "" : JSON.stringify(content);
}

export type TextChatInput = {
  system: string;
  prompt: string;
};

export class TextChatClient {
  private readonly groq: ChatGroq | null;
  private readonly orchestrator: FreeTierOrchestrator<LlmInput, string> | null;

  constructor() {
    if (process.env.TEXT_CHAT_PROVIDER === "orchestrator") {
      this.groq = null;
      this.orchestrator = buildTextOrchestrator();
      return;
    }

    this.groq = new ChatGroq({
      apiKey: process.env.GROQ_API_KEY,
      model: process.env.GROQ_TEXT_MODEL || "qwen/qwen3.8-27b",
      temperature: 0.1,
    });
    this.orchestrator = null;
  }

  async invoke(input: TextChatInput): Promise<string> {
    if (this.orchestrator) {
      return this.orchestrator.invoke(input);
    }

    const response = await this.groq!.invoke([
      new SystemMessage(input.system),
      new HumanMessage(input.prompt),
    ]);
    return messageContentToText(response.content);
  }
}