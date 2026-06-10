import fs from "node:fs";
import { execSync } from "node:child_process";
import { parse } from "csv-parse/sync";
import "../src/instrumentation"; // Must be imported before anything else for OTel
import { trace } from "@opentelemetry/api";
import { generateText, getApiKey } from "../src/llm-client";
import { tracerProvider, setupPhoenix } from "../src/instrumentation";

// Initialize Phoenix tracing
setupPhoenix();
import {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_STAGE_PROMPT_SIGNALS,
  DEFAULT_STAGE_PROMPT_CLASSIFICATION,
  DEFAULT_STAGE_PROMPT_MAP,
  DEFAULT_STAGE_PROMPT_WARNINGS,
  DEFAULT_STAGE_PROMPT_INFO,
  DEFAULT_RULES_PROMPT,
  DEFAULT_SIGNALS_RULES,
} from "../src/lib/classifier/templates";

const tracer = trace.getTracer("air-control");

async function runStage(
  stageName: string,
  systemPromptText: string,
  userPromptText: string,
  batchMeta?: { id: string, risk: string, role: string }
): Promise<string> {
  return tracer.startActiveSpan(`Stage: ${stageName}`, async (stageSpan) => {
    stageSpan.setAttribute("openinference.span.kind", "CHAIN");
    stageSpan.setAttribute("input.value", userPromptText);
    stageSpan.setAttribute("input.mime_type", "text/plain");
    
    if (batchMeta) {
      stageSpan.setAttribute("batch.item_id", batchMeta.id);
      stageSpan.setAttribute("batch.expected_risk", batchMeta.risk);
      stageSpan.setAttribute("batch.expected_role", batchMeta.role);
    }
    
    // Attach prompt structure to allow Phoenix Playground usage
    stageSpan.setAttribute("llm.prompt_template.template", `${systemPromptText}\n\n${userPromptText.replace(/"""[\s\S]*?"""/g, '{input}')}`);
    stageSpan.setAttribute("llm.prompt_template.variables", JSON.stringify({
      systemPrompt: systemPromptText,
      input: userPromptText
    }));

    try {
      const finalOutput = await generateText(systemPromptText, userPromptText);
      
      stageSpan.setAttribute("output.value", finalOutput);
      stageSpan.setAttribute("output.mime_type", "text/plain");
      
      // Token counts are harder to extract directly from the unified wrapper
      // since Anthropic/OpenAI return them differently, but Phoenix intercepts
      // the SDK calls anyway so they are traced correctly in the backend.
      


      stageSpan.end();
      return finalOutput;
    } catch (error: any) {
      stageSpan.recordException(error);
      stageSpan.end();
      throw error;
    }
  });
}

async function processRow(
  row: any,
  sessionId: string,
  systemPrompt: string,
  signalsSystemPrompt: string,
  stagePrompts: Record<string, string>,
  rulesPrompt: string,
  targetStage?: string
) {
  const description = (row.description || row["Product Description"] || "").trim();
  const id = row.id || row.Case || "unknown";
  
  if (!description) {
    console.log(`[${id}] Skipping row due to missing description.`);
    return;
  }

  console.log(`\n--- Processing ID: ${id} ---`);
  
  return tracer.startActiveSpan("Compliance Pipeline", async (parentSpan) => {
    parentSpan.setAttribute("openinference.span.kind", "CHAIN");
    parentSpan.setAttribute("session.id", sessionId);
    parentSpan.setAttribute("batch.item_id", id);
    parentSpan.setAttribute("batch.expected_risk", row.expected_risk || row["Expected Risk Classification"] || "");
    parentSpan.setAttribute("batch.expected_role", row.expected_role || row["Expected Role"] || "");
    
    try {
      const signalsRules = DEFAULT_SIGNALS_RULES;

      let signalsOutput = row.signals_output || "";
      let classificationOutput = row.classification_output || "";
      let mapOutput = "";

      // Determine which stages to run based on targetStage
      const stagesToRun = targetStage ? [targetStage.toUpperCase()] : ["SIGNALS", "CLASSIFICATION", "MAP", "WARNINGS", "INFO"];

      const batchMeta = { 
        id, 
        risk: row.expected_risk || row["Expected Risk Classification"] || "", 
        role: row.expected_role || row["Expected Role"] || "" 
      };

      // === STEP 1: SIGNALS ===
      if (stagesToRun.includes("SIGNALS")) {
        console.log(`[${id}] Running SIGNALS...`);
        signalsOutput = await runStage(
          "SIGNALS",
          `${signalsSystemPrompt}\n\n${stagePrompts.SIGNALS}\n\n${rulesPrompt}`,
          description,
          batchMeta
        );
      }

      // === STEP 2: CLASSIFICATION ===
      if (stagesToRun.includes("CLASSIFICATION")) {
        if (!signalsOutput) {
          throw new Error("Cannot run CLASSIFICATION without prior signals_output in CSV or running SIGNALS stage.");
        }
        console.log(`[${id}] Running CLASSIFICATION...`);
        classificationOutput = await runStage(
          "CLASSIFICATION",
          `${systemPrompt}\n\n${stagePrompts.CLASSIFICATION}\n\n${rulesPrompt}`,
          `Classify the product based on its description and these extracted signals:\n\nProduct Description:\n"""\n${description}\n"""\n\nSignals:\n${signalsOutput}`,
          batchMeta
        );
      }

      // === STEP 3: MAP ===
      if (stagesToRun.includes("MAP")) {
        if (!classificationOutput) {
          throw new Error("Cannot run MAP without prior classification_output in CSV or running CLASSIFICATION stage.");
        }
        console.log(`[${id}] Running MAP...`);
        mapOutput = await runStage(
          "MAP",
          `${systemPrompt}\n\n${stagePrompts.MAP}\n\n${rulesPrompt}`,
          `Map the obligations for this product:\n\nProduct Description:\n"""\n${description}\n"""\n\nClassification:\n${classificationOutput}`,
          batchMeta
        );
      }

      // === STEP 4: WARNINGS ===
      if (stagesToRun.includes("WARNINGS")) {
        console.log(`[${id}] Running WARNINGS...`);
        await runStage(
          "WARNINGS",
          `${systemPrompt}\n\n${stagePrompts.WARNINGS}\n\n${rulesPrompt}`,
          `Identify potential risk transformation warnings based on:\n\nProduct Description:\n"""\n${description}\n"""\n\nClassification:\n${classificationOutput}`,
          batchMeta
        );
      }

      // === STEP 5: INFO ===
      if (stagesToRun.includes("INFO")) {
        console.log(`[${id}] Running INFO...`);
        await runStage(
          "INFO",
          `${systemPrompt}\n\n${stagePrompts.INFO}\n\n${rulesPrompt}`,
          `Provide standard informational obligations for this product based on its Product Description:\n"""\n${description}\n""":\n\nClassification:\n${classificationOutput}\n\nMapped Articles:\n${mapOutput}`,
          batchMeta
        );
      }
      
      parentSpan.end();
      console.log(`[${id}] Finished.`);
    } catch (err: any) {
      parentSpan.recordException(err);
      parentSpan.end();
      console.error(`[${id}] Error: ${err.message}`);
    }
  });
}

async function main() {
  const args = process.argv.slice(2);
  let csvPath = "";
  let targetStage: string | undefined = undefined;
  let testQuantity: number | undefined = undefined;

  for (const arg of args) {
    if (arg.startsWith("--stage=")) {
      targetStage = arg.split("=")[1];
    } else if (arg.startsWith("--test-quantity=")) {
      testQuantity = parseInt(arg.split("=")[1], 10);
    } else if (!arg.startsWith("--")) {
      csvPath = arg;
    }
  }

  if (!csvPath) {
    console.error("Usage: npx tsx scripts/batch_runner.ts <path-to-csv> [--stage=STAGE_NAME] [--test-quantity=N]");
    process.exit(1);
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    console.error("ERROR: API Key is not set for the selected LLM_PROVIDER.");
    process.exit(1);
  }

  console.log(`Reading CSV from ${csvPath}...`);
  const fileContent = fs.readFileSync(csvPath, "utf-8");
  const records = parse(fileContent, { columns: true, skip_empty_lines: true });

  console.log(`Loaded ${records.length} records.`);
  
  if (targetStage) {
    console.log(`Target stage isolated to: ${targetStage.toUpperCase()}`);
  }

  let rowsToProcess = records;
  if (testQuantity && testQuantity > 0) {
    rowsToProcess = records.slice(0, testQuantity);
    console.log(`Limiting execution to the first ${testQuantity} rows (--test-quantity flag).`);
  }

  const stagePrefix = targetStage ? targetStage.toLowerCase() : "all";
  const sessionId = `batch-${stagePrefix}-${Date.now()}`;
  console.log(`\n=== Starting Batch Session: ${sessionId} ===\n`);
  
  console.log("Fetching global system prompt...");
  let systemPrompt = DEFAULT_SYSTEM_PROMPT;
  const promptName = "eu-ai-act-classifier-system-prompt";
  const isDev = process.env.NODE_ENV !== "production";
  const tagFlag = isDev ? " --tag development" : "";
  try {
    let pythonCmd = "python3";
    if (fs.existsSync(".venv/bin/python3.13")) {
      pythonCmd = ".venv/bin/python3.13";
    } else if (fs.existsSync(".venv/bin/python3")) {
      pythonCmd = ".venv/bin/python3";
    }
    const output = execSync(`${pythonCmd} scripts/fetch_prompt.py "${promptName}"${tagFlag}`, { encoding: "utf-8" }).trim();
    if (output) {
      systemPrompt = output;
      console.log(`Successfully fetched '${promptName}' from Phoenix (dev: ${isDev}).`);
    }
  } catch (err: any) {
    console.log(`Could not fetch '${promptName}' from Phoenix. Attempting local fallback...`);
    const fallbackPath = `resources/prompts/${promptName}.md`;
    if (fs.existsSync(fallbackPath)) {
      systemPrompt = fs.readFileSync(fallbackPath, "utf-8").trim();
      console.log(`Successfully loaded fallback prompt from ${fallbackPath}.`);
    } else {
      console.log(`Fallback file ${fallbackPath} not found. Using hardcoded DEFAULT_SYSTEM_PROMPT from templates.ts.`);
    }
  }

  async function fetchStagePrompt(stageName: string, defaultPrompt: string): Promise<string> {
    const promptName = `eu-ai-act-stage-${stageName.toLowerCase()}`;
    const tagFlag = isDev ? " --tag development" : "";
    try {
      let pythonCmd = "python3";
      if (fs.existsSync(".venv/bin/python3.13")) {
        pythonCmd = ".venv/bin/python3.13";
      } else if (fs.existsSync(".venv/bin/python3")) {
        pythonCmd = ".venv/bin/python3";
      }
      const output = execSync(`${pythonCmd} scripts/fetch_prompt.py "${promptName}"${tagFlag}`, { encoding: "utf-8" }).trim();
      if (output) {
        console.log(`Successfully fetched '${promptName}' from Phoenix for stage ${stageName} (dev: ${isDev}).`);
        return output;
      }
    } catch (err: any) {
      // Ignore and fallback
    }

    const fallbackPath = `resources/prompts/stage_${stageName.toLowerCase()}.md`;
    if (fs.existsSync(fallbackPath)) {
      console.log(`Loaded fallback prompt from ${fallbackPath} for stage ${stageName}.`);
      return fs.readFileSync(fallbackPath, "utf-8").trim();
    }

    return defaultPrompt;
  }

  console.log("Fetching stage prompts...");
  const stagePrompts = {
    SIGNALS: await fetchStagePrompt("SIGNALS", DEFAULT_STAGE_PROMPT_SIGNALS),
    CLASSIFICATION: await fetchStagePrompt("CLASSIFICATION", DEFAULT_STAGE_PROMPT_CLASSIFICATION),
    MAP: await fetchStagePrompt("MAP", DEFAULT_STAGE_PROMPT_MAP),
    WARNINGS: await fetchStagePrompt("WARNINGS", DEFAULT_STAGE_PROMPT_WARNINGS),
    INFO: await fetchStagePrompt("INFO", DEFAULT_STAGE_PROMPT_INFO),
  };

  const rulesPromptPath = "resources/prompts/prompt_rules.md";
  let rulesPrompt = DEFAULT_RULES_PROMPT;
  if (fs.existsSync(rulesPromptPath)) {
    rulesPrompt = fs.readFileSync(rulesPromptPath, "utf-8").trim();
    console.log(`Loaded rules prompt from ${rulesPromptPath}.`);
  }

  const signalsMatrixPath = "resources/signals_matrix.md";
  let signalsSystemPrompt = systemPrompt;
  if (fs.existsSync(signalsMatrixPath)) {
    const matrix = fs.readFileSync(signalsMatrixPath, "utf-8").trim();
    signalsSystemPrompt += `\n\n${matrix}`;
    console.log("Injected signals_matrix.md into signalsSystemPrompt.");
  }

  // Log the initial session details to local history
  const historyEntry = {
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    event: "batch_run_start",
    generation_prompts: {
      system_prompt: systemPrompt,
      signals_rules: DEFAULT_SIGNALS_RULES
    }
  };
  fs.appendFileSync(
    "resources/eval/prompt_history.jsonl",
    JSON.stringify(historyEntry) + "\n",
    "utf-8"
  );

  for (const row of rowsToProcess) {
    await processRow(row, sessionId, systemPrompt, signalsSystemPrompt, stagePrompts, rulesPrompt, targetStage);
  }

  console.log("\nAll batch items processed. Flushing telemetry...");
  if (tracerProvider) {
    await tracerProvider.forceFlush();
  }
  console.log("Done!");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
