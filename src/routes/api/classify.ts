import { createFileRoute } from "@tanstack/react-router";
import fs from "node:fs";
import path from "node:path";
import { streamText, getApiKey } from "../../llm-client";
import { tracerProvider } from "../../instrumentation";
import { trace } from "@opentelemetry/api";
import { 
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_RULES_PROMPT,
  DEFAULT_STAGE_PROMPT_SIGNALS,
  DEFAULT_STAGE_PROMPT_CLASSIFICATION,
  DEFAULT_STAGE_PROMPT_MAP,
  DEFAULT_STAGE_PROMPT_WARNINGS,
  DEFAULT_STAGE_PROMPT_INFO,
  DEFAULT_MD_TEMPLATE
} from "../../lib/classifier/templates";
import { parsePartial } from "../../lib/classifier/parser";
import { compileMarkdown } from "../../lib/classifier/reports";
// @ts-ignore
import signalsMatrixRaw from "../../../resources/signals_matrix.md?raw";
const promptFiles = import.meta.glob("../../../resources/prompts/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;


type Body = {
  systemPrompt?: string;
  signalsRules: string;
  description: string;
};

const tracer = trace.getTracer("air-control");

export const Route = createFileRoute("/api/classify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKey = getApiKey();
        if (!apiKey) {
          return new Response(
            JSON.stringify({ error: "No API_KEY is configured for the selected provider." }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }

        let body: Body;
        try {
          body = (await request.json()) as Body;
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const description = (body.description ?? "").toString().trim();
        if (!description) {
          return new Response(
            JSON.stringify({ error: "Missing description" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        if (description.length > 20000) {
          return new Response(
            JSON.stringify({ error: "Description too long" }),
            {
              status: 400,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        function resolvePrompt(promptName: string, fileName: string, defaultPrompt: string): string {
          // Priority 1: Vite bundled files (works in Vercel Serverless)
          const targetKey = `../../../resources/prompts/${fileName}`;
          if (promptFiles[targetKey]) {
            return promptFiles[targetKey].trim();
          }
          
          // Priority 2: Fallback to fs (for local dev edge cases if glob missed)
          const filePath = path.join(process.cwd(), `resources/prompts/${fileName}`);
          try {
            if (fs.existsSync(filePath)) {
              return fs.readFileSync(filePath, "utf-8").trim();
            }
          } catch (e) {
            console.error(`Failed to load prompt file ${fileName}:`, e);
          }

          // Priority 3: Phoenix (if dev)
          const isDev = process.env.NODE_ENV !== "production";
          if (isDev) {
            try {
              const { execSync } = require("child_process");
              let pythonCmd = "python3";
              if (fs.existsSync(".venv/bin/python3.13")) pythonCmd = ".venv/bin/python3.13";
              else if (fs.existsSync(".venv/bin/python3")) pythonCmd = ".venv/bin/python3";
              
              const output = execSync(`${pythonCmd} scripts/fetch_prompt.py "${promptName}" --tag development`, { encoding: "utf-8" }).trim();
              if (output) return output;
            } catch (e) {
              console.warn(`Could not fetch prompt ${promptName} via script. Falling back to default.`);
            }
          }
          
          return defaultPrompt;
        }

        let systemPrompt = resolvePrompt("eu-ai-act-classifier-system-prompt", "system_prompt.md", DEFAULT_SYSTEM_PROMPT);
        let signalsMatrixText = (body.signalsRules ?? "").toString().trim();

        if (!signalsMatrixText) {
          signalsMatrixText = (signalsMatrixRaw || "").trim();
        }
        
        try {
          const encoder = new TextEncoder();
          const readableStream = new ReadableStream({
            async start(controller) {
              await tracer.startActiveSpan("Compliance Pipeline", async (parentSpan) => {
                parentSpan.setAttribute("openinference.span.kind", "CHAIN");
                
                try {
                  // Helper to run a single LLM stage, stream it, and accumulate the result
                  async function runStage(stageName: string, systemPromptText: string, userPromptText: string) {
                    return tracer.startActiveSpan(`Stage: ${stageName}`, async (stageSpan) => {
                      stageSpan.setAttribute("openinference.span.kind", "CHAIN");
                      stageSpan.setAttribute("input.value", userPromptText);
                      stageSpan.setAttribute("input.mime_type", "text/plain");
                      
                      try {
                        // Inject the stage marker so the frontend parser knows where we are
                        controller.enqueue(encoder.encode(`data: {"choices":[{"delta":{"content":"[STAGE: ${stageName}]\\n"}}]}\n\n`));
                        
                        const stream = streamText(systemPromptText, userPromptText, { signal: request.signal });
                        
                        let accumulated = "";
                        for await (const text of stream) {
                          if (text) {
                            accumulated += text;
                            const payload = JSON.stringify({
                              choices: [{ delta: { content: text } }],
                            });
                            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
                          }
                        }
                        
                        // Add an extra newline between stages for the frontend parser
                        controller.enqueue(encoder.encode(`data: {"choices":[{"delta":{"content":"\\n\\n"}}]}\n\n`));
                        
                        const finalOutput = accumulated.trim();
                        stageSpan.setAttribute("output.value", finalOutput);
                        stageSpan.setAttribute("output.mime_type", "text/plain");
                        
                        stageSpan.end();
                        return finalOutput;
                      } catch (error: any) {
                        stageSpan.recordException(error);
                        stageSpan.end();
                        throw error;
                      }
                    });
                  }

                  // === STEP 1: SIGNALS ===
                  const signalsSystemPrompt = signalsMatrixText 
                    ? `${systemPrompt}\n\n${signalsMatrixText}` 
                    : systemPrompt;
                    
                  const signalsOutput = await runStage(
                    "SIGNALS",
                    `${signalsSystemPrompt}\n\n${resolvePrompt("eu-ai-act-stage-signals", "stage_signals.md", DEFAULT_STAGE_PROMPT_SIGNALS)}\n\n${resolvePrompt("eu-ai-act-prompt-rules", "prompt_rules.md", DEFAULT_RULES_PROMPT)}`,
                    description
                  );

                  // === STEP 2: CLASSIFICATION ===
                  const classificationOutput = await runStage(
                    "CLASSIFICATION",
                    `${systemPrompt}\n\n${resolvePrompt("eu-ai-act-stage-classification", "stage_classification.md", DEFAULT_STAGE_PROMPT_CLASSIFICATION)}\n\n${resolvePrompt("eu-ai-act-prompt-rules", "prompt_rules.md", DEFAULT_RULES_PROMPT)}`,
                    `Classify the product based on its description and these extracted signals:\n\nProduct Description:\n"""\n${description}\n"""\n\nSignals:\n${signalsOutput}`
                  );

                  // === STEP 3: MAP ===
                  const mapOutput = await runStage(
                    "MAP",
                    `${systemPrompt}\n\n${resolvePrompt("eu-ai-act-stage-map", "stage_map.md", DEFAULT_STAGE_PROMPT_MAP)}\n\n${resolvePrompt("eu-ai-act-prompt-rules", "prompt_rules.md", DEFAULT_RULES_PROMPT)}`,
                    `Map the obligations for this product:\n\nProduct Description:\n"""\n${description}\n"""\n\nClassification:\n${classificationOutput}`
                  );

                  // === STEP 4: WARNINGS ===
                  const warningsOutput = await runStage(
                    "WARNINGS",
                    `${systemPrompt}\n\n${resolvePrompt("eu-ai-act-stage-warnings", "stage_warnings.md", DEFAULT_STAGE_PROMPT_WARNINGS)}\n\n${resolvePrompt("eu-ai-act-prompt-rules", "prompt_rules.md", DEFAULT_RULES_PROMPT)}`,
                    `Identify potential risk transformation warnings based on:\n\nProduct Description:\n"""\n${description}\n"""\n\nClassification:\n${classificationOutput}`
                  );

                  // === STEP 5: INFO ===
                  const infoOutput = await runStage(
                    "INFO",
                    `${systemPrompt}\n\n${resolvePrompt("eu-ai-act-stage-info", "stage_info.md", DEFAULT_STAGE_PROMPT_INFO)}\n\n${resolvePrompt("eu-ai-act-prompt-rules", "prompt_rules.md", DEFAULT_RULES_PROMPT)}`,
                    `Provide standard informational obligations for this product based on its Product Description:\n"""\n${description}\n""":\n\nClassification:\n${classificationOutput}\n\nMapped Articles:\n${mapOutput}`
                  );

                  // === STEP 6: REPORTS ===
                  const interimRaw = `[STAGE: SIGNALS]\n${signalsOutput}\n[STAGE: CLASSIFICATION]\n${classificationOutput}\n[STAGE: MAP]\n${mapOutput}\n[STAGE: WARNINGS]\n${warningsOutput}\n[STAGE: INFO]\n${infoOutput}`;
                  const interimParsed = parsePartial(interimRaw);
                  
                  const interimMarkdown = compileMarkdown(DEFAULT_MD_TEMPLATE, {
                    description: description,
                    parsed: interimParsed,
                    disagreement: null,
                    generatedAt: new Date().toISOString()
                  });

                  const reportsOutput = await runStage(
                    "REPORTS",
                    `${systemPrompt}\n\n${resolvePrompt("eu-ai-act-stage-reports", "stage_reports.md", "Generate the audience-specific sections.")}`,
                    `Generate the audience-specific report sections based on the following interim compliance report:\n\n"""\n${interimMarkdown}\n"""`
                  );

                  controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                  controller.close();
                  
                  // End the parent span after all stages complete successfully
                  parentSpan.end();
                  
                  if (tracerProvider) {
                    tracerProvider.forceFlush().catch(console.error);
                  }
                } catch (err: any) {
                  parentSpan.recordException(err);
                  parentSpan.end();
                  controller.error(err);
                }
              });
            },
          });

          return new Response(readableStream, {
            status: 200,
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache, no-transform",
              "X-Accel-Buffering": "no",
            },
          });
        } catch (error: any) {
          console.error("LLM Error:", error);
          const status = error?.status || 502;
          const message = error?.message || "Upstream AI error";
          return new Response(JSON.stringify({ error: message }), {
            status,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
