#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_SIGNALS_RULES,
  DEFAULT_STAGE_PROMPT_SIGNALS,
  DEFAULT_STAGE_PROMPT_CLASSIFICATION,
  DEFAULT_STAGE_PROMPT_MAP,
  DEFAULT_STAGE_PROMPT_WARNINGS,
  DEFAULT_STAGE_PROMPT_INFO,
} from "../src/lib/classifier/templates";

// Ensure we have a URL for the API endpoint (defaults to localhost:3000 if not provided)
const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000";

const server = new Server(
  {
    name: "eu-ai-act-compliance-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
    },
  }
);

// Register Resources
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: "compliance://templates/prompt",
      name: "Default System Prompt",
      mimeType: "text/plain",
      description: "The default system prompt used by the EU AI Act Compliance Engine.",
    },
    {
      uri: "compliance://rules/signals",
      name: "Default Signals Rules",
      mimeType: "text/plain",
      description: "The default rules matrix used for evaluating compliance signals.",
    },
    {
      uri: "compliance://templates/stage/signals",
      name: "Default SIGNALS Stage Prompt",
      mimeType: "text/plain",
      description: "The default instruction for the SIGNALS stage.",
    },
    {
      uri: "compliance://templates/stage/classification",
      name: "Default CLASSIFICATION Stage Prompt",
      mimeType: "text/plain",
      description: "The default instruction for the CLASSIFICATION stage.",
    },
    {
      uri: "compliance://templates/stage/map",
      name: "Default MAP Stage Prompt",
      mimeType: "text/plain",
      description: "The default instruction for the MAP stage.",
    },
    {
      uri: "compliance://templates/stage/warnings",
      name: "Default WARNINGS Stage Prompt",
      mimeType: "text/plain",
      description: "The default instruction for the WARNINGS stage.",
    },
    {
      uri: "compliance://templates/stage/info",
      name: "Default INFO Stage Prompt",
      mimeType: "text/plain",
      description: "The default instruction for the INFO stage.",
    },
  ],
}));

function resolvePrompt(promptName: string, fileName: string, defaultPrompt: string): string {
  const fs = require("fs");
  const path = require("path");
  
  // Priority 1: File
  const filePath = path.join(process.cwd(), `resources/prompts/${fileName}`);
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, "utf-8").trim();
    }
  } catch (e) {}

  // Priority 2: Phoenix (if dev)
  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) {
    try {
      const { execSync } = require("child_process");
      let pythonCmd = "python3";
      if (fs.existsSync(".venv/bin/python3.13")) pythonCmd = ".venv/bin/python3.13";
      else if (fs.existsSync(".venv/bin/python3")) pythonCmd = ".venv/bin/python3";
      
      const output = execSync(`${pythonCmd} scripts/fetch_prompt.py "${promptName}" --tag development`, { encoding: "utf-8" }).trim();
      if (output) return output;
    } catch (e) {}
  }

  // Priority 3: Default
  return defaultPrompt;
}

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri === "compliance://templates/prompt") {
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "text/plain",
          text: resolvePrompt("eu-ai-act-classifier-system-prompt", "system_prompt.md", DEFAULT_SYSTEM_PROMPT),
        },
      ],
    };
  }
  
  if (request.params.uri === "compliance://rules/signals") {
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "text/plain",
          text: DEFAULT_SIGNALS_RULES,
        },
      ],
    };
  }

  const stageDefs: Record<string, { promptName: string, fileName: string, defaultPrompt: string }> = {
    "compliance://templates/stage/signals": { promptName: "eu-ai-act-stage-signals", fileName: "stage_signals.md", defaultPrompt: DEFAULT_STAGE_PROMPT_SIGNALS },
    "compliance://templates/stage/classification": { promptName: "eu-ai-act-stage-classification", fileName: "stage_classification.md", defaultPrompt: DEFAULT_STAGE_PROMPT_CLASSIFICATION },
    "compliance://templates/stage/map": { promptName: "eu-ai-act-stage-map", fileName: "stage_map.md", defaultPrompt: DEFAULT_STAGE_PROMPT_MAP },
    "compliance://templates/stage/warnings": { promptName: "eu-ai-act-stage-warnings", fileName: "stage_warnings.md", defaultPrompt: DEFAULT_STAGE_PROMPT_WARNINGS },
    "compliance://templates/stage/info": { promptName: "eu-ai-act-stage-info", fileName: "stage_info.md", defaultPrompt: DEFAULT_STAGE_PROMPT_INFO },
  };

  const def = stageDefs[request.params.uri];
  if (def) {
    return {
      contents: [
        {
          uri: request.params.uri,
          mimeType: "text/plain",
          text: resolvePrompt(def.promptName, def.fileName, def.defaultPrompt),
        },
      ],
    };
  }

  throw new McpError(
    ErrorCode.InvalidRequest,
    `Unknown resource: ${request.params.uri}`
  );
});

// Register Tools
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "evaluate_eu_ai_compliance",
      description: "Evaluates a product description against the EU AI Act (Regulation 2024/1689). Returns a structured compliance report containing the primary risk tier, role, reasoning, signals matrix, and specific article mappings. Note: This tool calls the internal web server endpoint; the web server must be running.",
      inputSchema: {
        type: "object",
        properties: {
          description: {
            type: "string",
            description: "The detailed product description or prototype specification to be evaluated. Include features, data sources, and intended use. IMPORTANT: This summary MUST be concisely limited to a maximum of 200 words to conserve API costs.",
          },
          systemPrompt: {
            type: "string",
            description: "Optional custom system prompt overriding the default engine prompt.",
          },
          signalsRules: {
            type: "string",
            description: "Optional custom rules for the signals quality matrix.",
          },
        },
        required: ["description"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "evaluate_eu_ai_compliance") {
    throw new McpError(
      ErrorCode.MethodNotFound,
      `Unknown tool: ${request.params.name}`
    );
  }

  const { description, systemPrompt, signalsRules } = request.params.arguments as any;

  if (typeof description !== "string") {
    throw new McpError(
      ErrorCode.InvalidParams,
      "Description must be a string."
    );
  }

  try {
    const url = `${API_BASE_URL}/api/v1/compliance/evaluate`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        description,
        systemPrompt,
        signalsRules,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        content: [
          {
            type: "text",
            text: `API request failed with status ${response.status}: ${errorText}`,
          },
        ],
        isError: true,
      };
    }

    const data = await response.json();

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(data, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      content: [
        {
          type: "text",
          text: `Error calling compliance API: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("EU AI Act Compliance MCP Server running on stdio");
}

run().catch((error) => {
  console.error("Failed to run MCP server:", error);
  process.exit(1);
});
