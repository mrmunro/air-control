import type { StageName } from "./mockStream";

export type Rating = "HIGH" | "MED" | "LOW";

export type SignalRow = {
  id: string;
  dimension: string;
  score: string;
  note: string;
};

export type SignalsSummary = {
  confidence: string;
  status?: string;
  reasoning?: string;
};

export type Classification = {
  primaryRisk: string;
  primaryRole: string;
  rationale: string;
};

export type MapItem = {
  snippet: string;
  ref: string;
  articleSnippet?: string;
  url: string;
  reasoning: string;
};

export type TitledItem = { title: string; detail: string };

export type Parsed = {
  signals: SignalRow[];
  signalsSummary: SignalsSummary | null;
  classification: Classification | null;
  map: MapItem[];
  warnings: TitledItem[];
  info: TitledItem[];
  reportsOutput: string;
};

export const emptyParsed = (): Parsed => ({
  signals: [],
  signalsSummary: null,
  classification: null,
  map: [],
  warnings: [],
  info: [],
  reportsOutput: "",
});

const STAGE_RE = /^\[STAGE:\s*([A-Z]+)\]\s*$/;

export function splitStages(raw: string): Record<string, string> {
  const lines = raw.split(/\r?\n/);
  const out: Record<string, string> = {};
  let current: string | null = null;
  let buf: string[] = [];
  const flush = () => {
    if (current) {
      const added = buf.join("\n").trim();
      if (added) {
        out[current] = out[current] ? out[current] + "\n" + added : added;
      }
    }
    buf = [];
  };
  for (const line of lines) {
    const m = line.match(STAGE_RE);
    if (m) {
      flush();
      const stage = m[1];
      if (stage === current) {
        // Repeated header for the SAME stage. Ignore header, keep accumulating!
      } else if (!out[stage]) {
        current = stage;
      } else {
        current = null; // ignore hallucinated past duplicate stage
      }
    } else if (current) {
      buf.push(line);
    }
  }
  flush();
  return out;
}

export function parseSignals(block: string): { rows: SignalRow[]; summary: SignalsSummary | null } {
  const rows: SignalRow[] = [];
  const lines = block.split("\n");
  let confidence = "";
  let status = "";
  let reasoning = "";

  for (const line of lines) {
    let trimmed = line.trim();
    if (trimmed.includes("OVERALL CLARITY CONFIDENCE:")) {
      const m = trimmed.match(/OVERALL CLARITY CONFIDENCE:\s*\*?\*?\s*(.*?)$/i);
      if (m) confidence = m[1].replace(/[*]/g, "").trim();
    }
    if (trimmed.includes("STATUS:")) {
      const m = trimmed.match(/STATUS:\s*\*?\*?\s*(.*?)$/i);
      if (m) status = m[1].replace(/[*]/g, "").trim();
    }
    if (trimmed.includes("CONFIDENCE REASONING:")) {
      const m = trimmed.match(/CONFIDENCE REASONING:\s*\*?\*?\s*(.*?)$/i);
      if (m) reasoning = m[1].replace(/[*]/g, "").trim();
    }

    // sometimes Gemini drops the outer pipes but keeps the inner ones
    // if it has at least 3 pipes, we can fake the outer pipes to parse it
    if (!trimmed.startsWith("|") && trimmed.split("|").length >= 4) {
      trimmed = `| ${trimmed} |`;
    }

    if (!trimmed.startsWith("|")) continue;
    
    const cells = trimmed
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim().replace(/[*]/g, ""));
      
    if (cells.length < 4) continue;
    // Skip markdown separator rows like |---|---| or |:---|---:|
    if (/^:?-+:?$/.test(cells[0]) || /^\s*$/.test(cells[0])) continue;
    // Skip header rows
    if (/^(#|id|signal|dimension|criteria|no\.?)$/i.test(cells[0])) continue;

    rows.push({
      id: cells[0],
      dimension: cells[1],
      score: cells[2],
      note: cells[3],
    });
  }
  
  const summary = (confidence || status || reasoning) ? { confidence, status, reasoning } : null;
  return { rows, summary };
}

export function parseClassification(block: string): Classification | null {
  const extract = (keyNames: string[]) => {
    for (const k of keyNames) {
      const kRegex = k.split(" ").join("[\\s_]*");
      const re = new RegExp(`^[^a-zA-Z]*${kRegex}[^a-zA-Z]*:\\s*(.+)$`, "mi");
      const m = block.match(re);
      if (m) return m[1].replace(/[*_`]/g, "").trim();
    }
    return "";
  };
  const primaryRisk = extract(["PRIMARY RISK", "PRIMARY_RISK", "RISK"]);
  const primaryRole = extract(["PRIMARY ROLE", "PRIMARY_ROLE", "ROLE"]);
  
  let rationale = "";
  const rationaleRe = /RATIONALE[\s_]*:\s*([\s\S]*)/mi;
  const rm = block.match(rationaleRe);
  if (rm) {
    rationale = rm[1].replace(/[*_`]/g, "").trim();
  } else {
    rationale = extract(["RATIONALE"]);
  }

  if (!primaryRisk && !primaryRole) return null;
  return { primaryRisk, primaryRole, rationale };
}

function parseDashItems(block: string): Array<Record<string, string>> {
  // Items begin with "- KEY:" and continue with "  KEY:" lines.
  const items: Array<Record<string, string>> = [];
  let current: Record<string, string> | null = null;
  let lastKey: string | null = null;
  for (const raw of block.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;
    const start = line.match(/^-\s*([A-Z_]+):\s*(.*)$/);
    const cont = line.match(/^\s+([A-Z_]+):\s*(.*)$/);
    if (start) {
      if (current) items.push(current);
      current = {};
      current[start[1].toLowerCase()] = stripQuotes(start[2]);
      lastKey = start[1].toLowerCase();
    } else if (cont && current) {
      current[cont[1].toLowerCase()] = stripQuotes(cont[2]);
      lastKey = cont[1].toLowerCase();
    } else if (current && lastKey) {
      current[lastKey] += " " + line.trim();
    }
  }
  if (current) items.push(current);
  return items;
}

function stripQuotes(s: string): string {
  return s.replace(/^"(.*)"$/, "$1").trim();
}

export function parseMap(block: string): MapItem[] {
  const items: MapItem[] = [];
  // Format A: dash-key block ("- SNIPPET: ..." + indented continuations).
  for (const i of parseDashItems(block)) {
    if (i.snippet || i.ref || i.url || i.reasoning || i.articlesnippet) {
      items.push({
        snippet: i.snippet ?? "",
        ref: i.ref ?? "",
        articleSnippet: i.articlesnippet ?? "",
        url: i.url ?? "",
        reasoning: i.reasoning ?? "",
      });
    }
  }
  // Format B (single-line, pipe-delimited):
  //   - "snippet" -> ref | articleSnippet | url | reasoning
  const lineRe = /^-\s*"?([^"\n]+?)"?\s*->\s*(.+)$/;
  for (const raw of block.split("\n")) {
    const m = raw.match(lineRe);
    if (!m) continue;
    const snippet = m[1].trim();
    const parts = m[2].split("|").map((p) => p.trim());
    const ref = parts[0] ?? "";
    let articleSnippet = "";
    let url = "";
    let reasoning = "";

    if (parts.length >= 4) {
      articleSnippet = stripQuotes(parts[1]);
      url = parts[2];
      reasoning = parts.slice(3).join(" | ");
    } else if (parts.length === 3) {
      url = parts[1];
      reasoning = parts[2];
    } else {
      reasoning = parts[1] ?? "";
    }

    if (url && url.toLowerCase() === "n/a") url = "";
    items.push({ snippet, ref, articleSnippet, url, reasoning });
  }
  const seen = new Set<string>();
  return items.filter((it) => {
    const k = `${it.snippet}::${it.ref}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function parseTitled(block: string): TitledItem[] {
  const items: TitledItem[] = [];
  // Format A: "- TITLE: ..." then "  DETAIL: ..."
  for (const i of parseDashItems(block)) {
    if (i.title || i.detail) {
      items.push({ title: i.title ?? "", detail: i.detail ?? "" });
    }
  }
  // Format B (single-line): "- <TITLE>: <detail>" or "* **<TITLE>**: <detail>" or "1. <TITLE>: <detail>"
  const lines = block.split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (!/^([-*]|\d+\.)\s/.test(line)) continue;
    
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    
    const markerMatch = line.match(/^([-*]|\d+\.)\s+/);
    if (!markerMatch) continue;
    
    const titleRaw = line.slice(markerMatch[0].length, colonIdx);
    const detailRaw = line.slice(colonIdx + 1);
    
    const title = titleRaw.replace(/[*_`]/g, "").trim();
    if (/^(TITLE|DETAIL|SNIPPET|REF|URL|REASONING)$/i.test(title)) continue;
    
    const detail = detailRaw.replace(/[*_`]/g, "").trim();
    if (title && detail) {
      items.push({ title, detail });
    }
  }
  const seen = new Set<string>();
  return items.filter((it) => {
    const k = `${it.title}::${it.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function parsePartial(raw: string): Parsed {
  const stages = splitStages(raw);
  const sigs = stages.SIGNALS ? parseSignals(stages.SIGNALS) : { rows: [], summary: null };
  return {
    signals: sigs.rows,
    signalsSummary: sigs.summary,
    classification: stages.CLASSIFICATION
      ? parseClassification(stages.CLASSIFICATION)
      : null,
    map: stages.MAP ? parseMap(stages.MAP) : [],
    warnings: stages.WARNINGS ? parseTitled(stages.WARNINGS) : [],
    info: stages.INFO ? parseTitled(stages.INFO) : [],
    reportsOutput: stages.REPORTS ? stages.REPORTS.trim() : "",
  };
}

export type StageId = StageName;
