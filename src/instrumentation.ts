import { register } from "@arizeai/phoenix-otel";
import { OpenAIInstrumentation } from "@arizeai/openinference-instrumentation-openai";
import { AnthropicInstrumentation } from "@arizeai/openinference-instrumentation-anthropic";

export let tracerProvider: any;

export function setupPhoenix() {
  tracerProvider = register({
    projectName: "air-control",
    url: "http://localhost:6006",
  });

  const openaiInstrumentation = new OpenAIInstrumentation();
  openaiInstrumentation.enable();

  const anthropicInstrumentation = new AnthropicInstrumentation();
  anthropicInstrumentation.enable();

  console.log("Arize Phoenix OpenTelemetry instrumentation initialized.");
}
