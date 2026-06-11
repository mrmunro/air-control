import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

function getProvider() {
  return (process.env.LLM_PROVIDER || "gemini").toLowerCase();
}

export function getApiKey() {
  const provider = getProvider();
  if (provider === "anthropic") return process.env.ANTHROPIC_API_KEY;
  if (provider === "openai") return process.env.OPENAI_API_KEY;
  return process.env.GEMINI_API_KEY;
}

function getModel() {
  const provider = getProvider();
  if (process.env.LLM_MODEL) return process.env.LLM_MODEL;
  if (provider === "anthropic") return "claude-sonnet-4-6";
  if (provider === "openai") return "gpt-4o";
  return "gemini-3.5-flash";
}

function getOpenAIClient(apiKey: string, provider: string) {
  if (provider === "gemini") {
    return new OpenAI({
      apiKey,
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    });
  }
  return new OpenAI({ apiKey });
}

export async function generateText(
  systemPromptText: string,
  userPromptText: string,
  options?: { signal?: AbortSignal }
): Promise<string> {
  const provider = getProvider();
  const model = getModel();
  const apiKey = getApiKey();
  
  if (!apiKey) {
    throw new Error(`Missing API Key for provider: ${provider}`);
  }

  if (provider === "anthropic") {
    const anthropic = new Anthropic({ apiKey });
    const response = await anthropic.messages.create(
      {
        model,
        max_tokens: 7000,
        system: systemPromptText,
        messages: [{ role: "user", content: userPromptText }],
      },
      { signal: options?.signal }
    );
    // Extract text from Anthropic response block
    const block = response.content[0];
    return block.type === "text" ? block.text : "";
  } else {
    const client = getOpenAIClient(apiKey, provider);
    const response = await client.chat.completions.create(
      {
        model,
        max_tokens: 7000,
        stream: false,
        messages: [
          { role: "system", content: systemPromptText },
          { role: "user", content: userPromptText },
        ],
      },
      { signal: options?.signal }
    );
    return response.choices[0]?.message?.content || "";
  }
}

export async function* streamText(
  systemPromptText: string,
  userPromptText: string,
  options?: { signal?: AbortSignal }
): AsyncGenerator<string, void, unknown> {
  const provider = getProvider();
  const model = getModel();
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error(`Missing API Key for provider: ${provider}`);
  }

  if (provider === "anthropic") {
    const anthropic = new Anthropic({ apiKey });
    const stream = await anthropic.messages.create(
      {
        model,
        max_tokens: 7000,
        stream: true,
        system: systemPromptText,
        messages: [{ role: "user", content: userPromptText }],
      },
      { signal: options?.signal }
    );
    for await (const chunk of stream) {
      if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
        yield chunk.delta.text;
      }
    }
  } else {
    const client = getOpenAIClient(apiKey, provider);
    const stream = await client.chat.completions.create(
      {
        model,
        max_tokens: 7000,
        stream: true,
        messages: [
          { role: "system", content: systemPromptText },
          { role: "user", content: userPromptText },
        ],
      },
      { signal: options?.signal }
    );
    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content || "";
      if (text) {
        yield text;
      }
    }
  }
}

