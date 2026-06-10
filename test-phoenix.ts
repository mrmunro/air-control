import { register } from "@arizeai/phoenix-otel";
import { OpenAIInstrumentation } from "@arizeai/openinference-instrumentation-openai";
import { diag, DiagConsoleLogger, DiagLogLevel } from "@opentelemetry/api";
diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
import { getGeminiClient } from "./src/llm-client";

process.env.PHOENIX_COLLECTOR_ENDPOINT = "http://localhost:6006/v1/traces";
process.env.PHOENIX_PROJECT_NAME = "air-control-test";

const tracerProvider = register({});

const instrumentation = new OpenAIInstrumentation();
instrumentation.enable();

async function main() {
  console.log("Calling Gemini...");
  const key = process.env.GEMINI_API_KEY || "dummy";
  const geminiClient = getGeminiClient(key);
  
  try {
    const stream = await geminiClient.chat.completions.create({
      model: "gemini-3.5-flash",
      stream: true,
      messages: [{ role: "user", content: "Say hi" }],
    });
    
    for await (const chunk of stream) {
      process.stdout.write(chunk.choices[0]?.delta?.content || "");
    }
    console.log("\nStream done.");
  } catch (e) {
    console.error("API Error:", e.message);
  }
  
  console.log("Forcing flush...");
  await tracerProvider.forceFlush();
  console.log("Flushed!");
}

main().catch(console.error);
