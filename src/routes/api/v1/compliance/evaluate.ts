// @ts-ignore
import rulesPromptRaw from "../../../../../resources/prompts/prompt_rules.md?raw";

// @ts-ignore

import { createFileRoute } from "@tanstack/react-router";
import fs from "node:fs";
import path from "node:path";
import { generateText, getApiKey } from "../../../../llm-client";
import { tracerProvider } from "../../../../instrumentation";
import { trace } from "@opentelemetry/api";
import { parsePartial } from "../../../../lib/classifier/parser";
import {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_RULES_PROMPT,
  DEFAULT_SIGNALS_RULES,
} from "../../../../lib/classifier/templates";

type Body = {
  description: string;
  systemPrompt?: string;
  signalsRules?: string;
};

const tracer = trace.getTracer("air-control");

export const Route = createFileRoute("/api/v1/compliance/evaluate")({
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

        const systemPrompt = (body.systemPrompt ?? "").toString() || DEFAULT_SYSTEM_PROMPT;
        const signalsRules = (body.signalsRules ?? "").toString() || DEFAULT_SIGNALS_RULES;

        let rulesPrompt = DEFAULT_RULES_PROMPT;
        if (rulesPromptRaw) {
          rulesPrompt = rulesPromptRaw.trim();
        }

        try {
          const report = await tracer.startActiveSpan("Compliance Pipeline (Evaluate)", async (parentSpan) => {
            parentSpan.setAttribute("openinference.span.kind", "CHAIN");
            
            try {
              async function runStage(stageName: string, systemPromptText: string, userPromptText: string) {
                return tracer.startActiveSpan(`Stage: ${stageName}`, async (stageSpan) => {
                  stageSpan.setAttribute("openinference.span.kind", "CHAIN");
                  stageSpan.setAttribute("input.value", userPromptText);
                  stageSpan.setAttribute("input.mime_type", "text/plain");
                  
                  try {
                    const finalOutput = await generateText(systemPromptText, userPromptText, { signal: request.signal });
                    
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
              const signalsOutput = await runStage(
                "SIGNALS",
                `${systemPrompt}\n\nRespond ONLY with a markdown table with exactly these 4 columns: | # | Dimension / Criteria | Score | Notes / Details |\nUnder the table, output exactly:\nOVERALL CLARITY CONFIDENCE: <percentage>\nSTATUS: <status>\n\n${signalsRules}\n\n${rulesPrompt}`,
                description
              );

              // === STEP 2: CLASSIFICATION ===
              const classificationOutput = await runStage(
                "CLASSIFICATION",
                `${systemPrompt}\n\nRespond ONLY with exactly:\nPRIMARY_RISK: <UNACCEPTABLE | HIGH | LIMITED | MINIMAL>\nPRIMARY_ROLE: <PROVIDER | DEPLOYER | DISTRIBUTOR | IMPORTER>\nRATIONALE: <one paragraph>\n\n${rulesPrompt}`,
                `Classify the product based on its description and these extracted signals:\n\nProduct Description:\n"""\n${description}\n"""\n\nSignals:\n${signalsOutput}`
              );

              // === STEP 3: MAP ===
              const mapOutput = await runStage(
                "MAP",
                `${systemPrompt}\n\nRespond ONLY with a bulleted list (3-6 items) matching this format:\n- "<short snippet>" -> <Article X(y) or Annex III §n> | <https://eur-lex link or "n/a"> | <one-sentence reasoning>\n\n${rulesPrompt}`,
                `Map the obligations for this product:\n\nProduct Description:\n"""\n${description}\n"""\n\nClassification:\n${classificationOutput}`
              );

              // === STEP 4: WARNINGS ===
              const warningsOutput = await runStage(
                "WARNINGS",
                `${systemPrompt}\n\nRespond ONLY with a bulleted list (2-4 items) matching this format:\n- <TITLE>: <one-sentence risk transformation scenario>\n\n${rulesPrompt}`,
                `Identify potential risk transformation warnings based on:\n\nProduct Description:\n"""\n${description}\n"""\n\nClassification:\n${classificationOutput}`
              );

              // === STEP 5: INFO ===
              const infoOutput = await runStage(
                "INFO",
                `${systemPrompt}\n\nRespond ONLY with a bulleted list (3-6 items) matching this format:\n- <OBLIGATION TITLE>: <one-sentence description>\n\n${rulesPrompt}`,
                `Provide standard informational obligations for this product based on its Product Description:\n"""\n${description}\n""":\n\nClassification:\n${classificationOutput}\n\nMapped Articles:\n${mapOutput}`
              );

              // End the parent span after all stages complete successfully
              parentSpan.end();
              
              if (tracerProvider) {
                tracerProvider.forceFlush().catch(console.error);
              }

              // Combine all outputs into the format expected by the parser
              const fullText = `[STAGE: SIGNALS]\n${signalsOutput}\n[STAGE: CLASSIFICATION]\n${classificationOutput}\n[STAGE: MAP]\n${mapOutput}\n[STAGE: WARNINGS]\n${warningsOutput}\n[STAGE: INFO]\n${infoOutput}`;

              const parsed = parsePartial(fullText);
              // ensure we don't return null classification
              if (!parsed.classification) {
                  parsed.classification = {
                      primaryRisk: "UNKNOWN",
                      primaryRole: "UNKNOWN",
                      rationale: "Failed to parse classification."
                  };
              }
              
              return {
                signals: parsed.signals,
                classification: parsed.classification,
                mappings: parsed.map.map(m => ({
                    snippet: m.snippet,
                    reference: m.ref,
                    url: m.url,
                    reasoning: m.reasoning
                })),
                warnings: parsed.warnings,
                obligations: parsed.info
              };
            } catch (err: any) {
              parentSpan.recordException(err);
              parentSpan.end();
              throw err;
            }
          });

          return new Response(JSON.stringify(report), {
            status: 200,
            headers: {
              "Content-Type": "application/json",
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
