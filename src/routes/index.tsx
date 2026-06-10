import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect, useMemo } from "react";
import {
  Settings,
  Trash2,
  Cpu,
  Play,
  ChevronRight,
  ChevronDown,
  AlertTriangle,
  Info,
  HelpCircle,
  FileText,
  Download,
  ThumbsDown,
  ExternalLink,
  History,
  X,
} from "lucide-react";
import {
  MOCK_STREAM,
  STAGE_ORDER,
  type StageName,
} from "@/lib/classifier/mockStream";
import {
  parsePartial,
  emptyParsed,
  type Parsed,
} from "@/lib/classifier/parser";
import {
  compileMarkdown,
  compileHtml,
  downloadBlob,
  type Disagreement,
} from "@/lib/classifier/reports";
import {
  DEFAULT_MD_TEMPLATE,
  DEFAULT_HTML_TEMPLATE,
  DEFAULT_SYSTEM_PROMPT,
  DEFAULT_SIGNALS_RULES,
} from "@/lib/classifier/templates";
import { streamLive } from "@/lib/classifier/liveStream";
import { deriveProductName } from "@/lib/classifier/reports";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "EU AI Act Compliance Engine" },
      {
        name: "description",
        content:
          "Minimalist terminal UI for classifying products under the EU AI Act.",
      },
      { property: "og:title", content: "EU AI Act Compliance Engine" },
      {
        property: "og:description",
        content:
          "Classify products against the EU AI Act with a minimalist terminal interface.",
      },
    ],
  }),
  component: Index,
});

type LogLine = { kind: "system" | "user" | "out" | "stage"; text: string };
type StageStatus = "idle" | "running" | "done";
type HistoryEntry = {
  id: string;
  timestamp: string;
  description: string;
  parsed: Parsed;
};

const ICON_STROKE = 1.5;
const HISTORY_KEY = "eu-ai-act.history.v1";
const CONFIG_KEY = "eu-ai-act.config.v1";

type ApiProvider = "GEMINI" | "OPENAI";
type EngineConfig = {
  apiKey: string;
  apiProvider: ApiProvider;
  signalsRules: string;
  mdTemplate: string;
  htmlTemplate: string;
};
const defaultConfig = (): EngineConfig => ({
  apiKey: "",
  apiProvider: "GEMINI",
  signalsRules: DEFAULT_SIGNALS_RULES,
  mdTemplate: DEFAULT_MD_TEMPLATE,
  htmlTemplate: DEFAULT_HTML_TEMPLATE,
});

const STAGE_LABEL: Record<StageName, string> = {
  SIGNALS: "Analysing description...",
  CLASSIFICATION: "Classifying risk...",
  MAP: "Mapping to Act clauses...",
  WARNINGS: "Generating warnings...",
  INFO: "Fetching obligations...",
  REPORTS: "Compiling reports...",
};

const STAGE_BANNER: Record<StageName, string> = {
  SIGNALS: ">> ANALYSING DESCRIPTION SIGNALS...",
  CLASSIFICATION: ">> CLASSIFYING RISK & ROLES...",
  MAP: ">> MAPPING DESCRIPTION SNIPPETS TO ACT CLAUSES...",
  WARNINGS: ">> GENERATING RISK TRANSFORMATION SCENARIOS...",
  INFO: ">> FETCHING SYSTEM OBLIGATIONS...",
  REPORTS: ">> COMPILING COMPLIANCE REPORTS (MARKDOWN/HTML)...",
};

function splitStageBlocks(raw: string): Record<StageName, string> {
  const out = {} as Record<StageName, string>;
  for (const s of STAGE_ORDER) out[s] = "";
  const re = /\[STAGE:\s*([A-Z]+)\]/g;
  const matches: Array<{ name: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    matches.push({ name: m[1], start: m.index, end: m.index + m[0].length });
  }
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const body = raw.slice(cur.end, next ? next.start : raw.length).trim();
    if ((STAGE_ORDER as readonly string[]).includes(cur.name)) {
      out[cur.name as StageName] = body;
    }
  }
  return out;
}

function FormatText({ text }: { text: string }) {
  if (!text) return null;
  return (
    <>
      {text.split(/<br\s*\/?>/i).map((line, i, arr) => (
        <span key={i}>
          {line}
          {i < arr.length - 1 && <br />}
        </span>
      ))}
    </>
  );
}

function Index() {
  const [description, setDescription] = useState("");
  const [logs, setLogs] = useState<LogLine[]>([
    { kind: "system", text: "Ready. Input description and press CLASSIFY." },
  ]);
  const [running, setRunning] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsLocked = import.meta.env.PROD;
  const [stageStatus, setStageStatus] = useState<
    Record<StageName, StageStatus>
  >({
    SIGNALS: "idle",
    CLASSIFICATION: "idle",
    MAP: "idle",
    WARNINGS: "idle",
    INFO: "idle",
    REPORTS: "idle",
  });
  const [parsed, setParsed] = useState<Parsed>(emptyParsed());
  const [currentStage, setCurrentStage] = useState<
    StageName | null
  >(null);
  const [completedAt, setCompletedAt] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [clock, setClock] = useState<string>("--:--:--");
  const [openMap, setOpenMap] = useState<Record<number, boolean>>({});
  const [warningsOpen, setWarningsOpen] = useState(true);
  const [infoOpen, setInfoOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [mdTemplate, setMdTemplate] = useState<string>(DEFAULT_MD_TEMPLATE);
  const [htmlTemplate, setHtmlTemplate] = useState<string>(
    DEFAULT_HTML_TEMPLATE,
  );
  const [disagreement, setDisagreement] = useState<Disagreement>(null);
  const [disagreeOpen, setDisagreeOpen] = useState(false);
  const [disagreeReason, setDisagreeReason] = useState("");
  const [disagreeRisk, setDisagreeRisk] = useState("");
  const [disagreeRole, setDisagreeRole] = useState("");

  const [helpOpen, setHelpOpen] = useState(false);
  const [helpContent, setHelpContent] = useState<{overviewHtml: string; guideHtml: string} | null>(null);
  const [helpTab, setHelpTab] = useState<"overview" | "guide">("overview");
  const [flashGuide, setFlashGuide] = useState(false);
  const [disagreeSnippets, setDisagreeSnippets] = useState<Record<string, string>>({});
  const [previewOpen, setPreviewOpen] = useState(false);

  // Settings drawer state
  const [draftConfig, setDraftConfig] = useState<EngineConfig>(defaultConfig);
  const [savedConfig, setSavedConfig] = useState<EngineConfig>(defaultConfig);
  const [banner, setBanner] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);

  const termRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  // Hydration-safe UTC clock — only set after mount.
  useEffect(() => {
    const tick = () => setClock(new Date().toISOString().slice(11, 19));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Load history from LocalStorage.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }, []);

  // Load engine configuration from LocalStorage on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(CONFIG_KEY);
      if (raw) {
        const merged = {
          ...defaultConfig(),
          ...JSON.parse(raw),
        } as EngineConfig;
        setSavedConfig(merged);
        setDraftConfig(merged);
        setMdTemplate(merged.mdTemplate);
        setHtmlTemplate(merged.htmlTemplate);
      }
    } catch {
      /* ignore */
    }
  }, []);

  // Auto-dismiss success banner.
  useEffect(() => {
    if (!banner) return;
    const id = setTimeout(() => setBanner(null), 2800);
    return () => clearTimeout(id);
  }, [banner]);

  const openSettings = () => {
    setDraftConfig(savedConfig);
    setSettingsOpen(true);
  };
  const saveConfig = () => {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(draftConfig));
    } catch {
      /* ignore */
    }
    setSavedConfig(draftConfig);
    setMdTemplate(draftConfig.mdTemplate);
    setHtmlTemplate(draftConfig.htmlTemplate);
    setSettingsOpen(false);
    setBanner("Configuration saved to local storage.");
  };
  const resetConfig = () => {
    setDraftConfig(defaultConfig());
    setBanner("Defaults restored. Press SAVE to persist.");
  };

  useEffect(() => {
    if (termRef.current)
      termRef.current.scrollTop = termRef.current.scrollHeight;
  }, [logs]);

  const appendLog = (l: LogLine) => setLogs((arr) => [...arr, l]);

  const sleep = (ms: number) =>
    new Promise<void>((res) => {
      const id = setTimeout(res, ms);
      // best-effort cancellation: if cancelled, resolve early
      const check = setInterval(() => {
        if (abortRef.current.cancelled) {
          clearTimeout(id);
          clearInterval(check);
          res();
        }
      }, 40);
    });

  const resetPipeline = () => {
    setCompletedAt(null);
    setParsed(emptyParsed());
    setStageStatus({
      SIGNALS: "idle",
      CLASSIFICATION: "idle",
      MAP: "idle",
      WARNINGS: "idle",
      INFO: "idle",
      REPORTS: "idle",
    });
    setOpenMap({});
  };

  const finalizeRun = async (acc: string, ts: string) => {
    // End of stream; all stages complete.
    await sleep(320);
    const finalParsed = parsePartial(acc);
    appendLog({ kind: "out", text: "report.md  ......... OK" });
    await sleep(120);
    appendLog({ kind: "out", text: "report.html ........ OK" });
    await sleep(120);
    const entry: HistoryEntry = {
      id: Math.random().toString(36).slice(2) + Date.now().toString(36),
      timestamp: ts,
      description,
      parsed: finalParsed,
    };
    setHistory((h) => {
      const next = [entry, ...h].slice(0, 20);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    setStageStatus((s) => ({ ...s, REPORTS: "done" }));
    setCompletedAt(new Date().toISOString());
    appendLog({
      kind: "system",
      text: "DONE. Review results. Use [I DISAGREE] to flag mis-classification.",
    });
  };

  // Simulated run using the bundled MOCK_STREAM.
  const runSimulation = async (ts: string) => {
    const blocks = splitStageBlocks(MOCK_STREAM);
    let acc = "";
    for (const stage of STAGE_ORDER) {
      if (abortRef.current.cancelled) break;
      setCurrentStage(stage);
      setStageStatus((s) => ({ ...s, [stage]: "running" }));
      appendLog({ kind: "stage", text: STAGE_BANNER[stage] });
      await sleep(240);
      acc += `[STAGE: ${stage}]\n`;
      const body = blocks[stage] ?? "";
      for (const line of body.split("\n")) {
        if (abortRef.current.cancelled) break;
        acc += line + "\n";
        if (line.trim()) appendLog({ kind: "out", text: line });
        setParsed(parsePartial(acc));
        await sleep(stage === "CLASSIFICATION" ? 80 : 40);
      }
      setStageStatus((s) => ({ ...s, [stage]: "done" }));
    }
    await finalizeRun(acc, ts);
  };

  // Live run against Gemini / OpenAI using the API key from settings.
  const runLive = async (ts: string) => {
    const seen = new Set<StageName>();
    let acc = "";
    let pendingLine = "";
    let lastProcessedIndex = 0;
    setCurrentStage("SIGNALS");
    setStageStatus((s) => ({ ...s, SIGNALS: "running" }));
    appendLog({ kind: "stage", text: `>> AI STREAM OPEN — ${ts}` });

    const handleStageTransition = (fullText: string) => {
      const re = /\[STAGE:\s*([A-Z]+)\]/g;
      re.lastIndex = lastProcessedIndex;
      let m: RegExpExecArray | null;
      while ((m = re.exec(fullText)) !== null) {
        lastProcessedIndex = m.index + m[0].length;
        const name = m[1] as StageName;
        if (!(STAGE_ORDER as readonly string[]).includes(name)) continue;
        if (seen.has(name)) continue;
        
        // Mark earlier stages done.
        for (const s of STAGE_ORDER) {
          if (s === name) break;
          if (!seen.has(s)) setStageStatus((st) => ({ ...st, [s]: "done" }));
          seen.add(s);
        }
        seen.add(name);
        setCurrentStage(name);
        setStageStatus((st) => ({ ...st, [name]: "running" }));
        appendLog({ kind: "stage", text: STAGE_BANNER[name] });
      }
    };

    const onChunk = (delta: string) => {
      if (abortRef.current.cancelled) return;
      acc += delta;
      
      if (acc.includes("[STAGE: ERROR]")) {
        // Stream lines into the terminal as they complete, but don't parse stages
        pendingLine += delta;
        let nl: number;
        while ((nl = pendingLine.indexOf("\n")) !== -1) {
          const line = pendingLine.slice(0, nl);
          pendingLine = pendingLine.slice(nl + 1);
          if (line.trim() && !/\[STAGE:/.test(line.trim())) {
            appendLog({ kind: "out", text: line });
          }
        }
        return;
      }

      handleStageTransition(acc);
      // Stream lines into the terminal as they complete.
      pendingLine += delta;
      let nl: number;
      while ((nl = pendingLine.indexOf("\n")) !== -1) {
        const line = pendingLine.slice(0, nl);
        pendingLine = pendingLine.slice(nl + 1);
        if (line.trim() && !/\[STAGE:/.test(line.trim())) {
          appendLog({ kind: "out", text: line });
        }
      }
      setParsed(parsePartial(acc));
    };

    const controller = new AbortController();
    const cancelWatcher = setInterval(() => {
      if (abortRef.current.cancelled) controller.abort();
    }, 80);

    try {
      await streamLive({
        signalsRules: savedConfig.signalsRules,
        description,
        signal: controller.signal,
        onChunk,
      });
    } finally {
      clearInterval(cancelWatcher);
    }
    
    if (acc.includes("[STAGE: ERROR]")) {
      const msg = acc.split(/\[STAGE:\s*ERROR\]/)[1]?.trim();
      throw new Error("Invalid Input: " + (msg || "The provided description is not a valid product description."));
    }

    // Flush any trailing partial line.
    if (pendingLine.trim()) appendLog({ kind: "out", text: pendingLine });

    // Mark all stages done.
    for (const s of STAGE_ORDER)
      setStageStatus((st) => ({ ...st, [s]: "done" }));
    await finalizeRun(acc, ts);
  };

  const classify = async (forceSimulation = false) => {
    if (!description.trim() || running) return;
    abortRef.current = { cancelled: false };
    setRunning(true);
    setLiveError(null);
    resetPipeline();

    const ts = new Date().toISOString();
    appendLog({ kind: "user", text: `> CLASSIFY ${ts}` });
    appendLog({
      kind: "out",
      text: `input: ${description.slice(0, 80)}${description.length > 80 ? "…" : ""}`,
    });

    try {
      if (forceSimulation) {
        await runSimulation(ts);
      } else {
        await runLive(ts);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      appendLog({ kind: "system", text: "ERROR: Live classification failed." });
      appendLog({ kind: "out", text: `// ${msg}` });
      setLiveError(msg);
    }

    setCurrentStage(null);
    setRunning(false);
  };

  const clearAll = () => {
    abortRef.current.cancelled = true;
    setDescription("");
    setLogs([
      { kind: "system", text: "Ready. Input description and press CLASSIFY." },
    ]);
    setParsed(emptyParsed());
    setCompletedAt(null);
    setStageStatus({
      SIGNALS: "idle",
      CLASSIFICATION: "idle",
      MAP: "idle",
      WARNINGS: "idle",
      INFO: "idle",
      REPORTS: "idle",
    });
    setCurrentStage(null);
    setRunning(false);
  };

  const buildCtx = () => ({
    description,
    parsed,
    disagreement,
    generatedAt: completedAt ?? new Date().toISOString(),
  });

  const downloadMd = () => {
    const md = compileMarkdown(mdTemplate, buildCtx());
    downloadBlob("eu-ai-act-report.md", "text/markdown;charset=utf-8", md);
  };
  const downloadHtmlReport = () => {
    const html = compileHtml(htmlTemplate, buildCtx());
    downloadBlob("eu-ai-act-report.html", "text/html;charset=utf-8", html);
  };
  const openPreview = () => setPreviewOpen(true);

  const openDisagree = () => {
    setDisagreeReason(disagreement?.reason ?? "");
    setDisagreeRisk(disagreement?.proposedRisk ?? "");
    setDisagreeRole(disagreement?.proposedRole ?? "");
    setDisagreeSnippets(disagreement?.snippetComments ?? {});
    setDisagreeOpen(true);
  };
  const submitDisagree = () => {
    if (!disagreeReason.trim()) return;
    
    // Filter out empty snippet comments
    const cleanSnippets: Record<string, string> = {};
    for (const [k, v] of Object.entries(disagreeSnippets)) {
      if (v.trim()) cleanSnippets[k] = v.trim();
    }
    
    const d: Disagreement = {
      reason: disagreeReason.trim(),
      proposedRisk: disagreeRisk.trim() || undefined,
      proposedRole: disagreeRole.trim() || undefined,
      filedAt: new Date().toISOString(),
      snippetComments: Object.keys(cleanSnippets).length > 0 ? cleanSnippets : undefined,
    };
    setDisagreement(d);
    setDisagreeOpen(false);
    appendLog({ kind: "user", text: "> DISAGREE filed. Embedded in report." });
    appendLog({
      kind: "out",
      text: `feedback.id = ${Math.random().toString(36).slice(2, 10)}`,
    });
  };

  const loadHistory = (h: HistoryEntry) => {
    setDescription(h.description);
    setParsed(h.parsed);
    setCompletedAt(h.timestamp);
    setStageStatus({
      SIGNALS: "done",
      CLASSIFICATION: "done",
      MAP: "done",
      WARNINGS: "done",
      INFO: "done",
      REPORTS: "done",
    });
    appendLog({ kind: "system", text: `Loaded run ${h.id} from history.` });
  };

  const clearHistory = () => {
    setHistory([]);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      /* ignore */
    }
  };

  const overallProgress = useMemo(() => {
    const stages: Array<StageName> = [...STAGE_ORDER];
    const done = stages.filter((s) => stageStatus[s] === "done").length;
    return Math.round((done / stages.length) * 100);
  }, [stageStatus]);

  return (
    <main
      className="min-h-screen w-full flex items-center justify-center p-4 sm:p-8"
      style={{ backgroundColor: "#000000" }}
    >
      <div
        className="w-full max-w-[1536px] bg-white border border-black"
        style={{ boxShadow: "0 8px 24px rgba(255,255,255,0.04)" }}
      >
        {/* Top breadcrumb / nav bar */}
        <div className="flex items-center justify-between border-b border-black px-4 py-2 text-[11px] tracking-[0.18em] uppercase">
          <nav className="flex items-center gap-2 text-black">
            <Cpu size={14} strokeWidth={ICON_STROKE} />
            <span className="bg-[#FFFF00] px-1.5">AIR Control</span>
          </nav>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setHistoryOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 border border-black px-2 py-0.5 hover:bg-neutral-100 transition"
            >
              <History size={12} strokeWidth={ICON_STROKE} />
              History ({history.length})
            </button>
            <span className="hidden sm:inline">v0.1.0</span>
            <span className="flex items-center gap-1.5">
              <span
                className={`inline-block w-2 h-2 border border-black ${running ? "bg-[#FFFF00]" : "bg-white"}`}
              />
              {running ? "Streaming" : "Online"}
            </span>
          </div>
        </div>

        {/* Asymmetrical grid */}
        <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr]">
          {/* LEFT — Input + Results */}
          <section className="border-b lg:border-b-0 lg:border-r border-black p-6 flex flex-col gap-5">
            <header className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 border border-black flex items-center justify-center">
                  <Cpu size={18} strokeWidth={ICON_STROKE} />
                </div>
                <h1 className="text-[15px] sm:text-base uppercase tracking-[0.22em]">
                  EU AI Act Compliance Engine
                </h1>
              </div>
              <button
                onClick={openSettings}
                aria-label="Settings"
                disabled={settingsLocked}
                title={
                  settingsLocked
                    ? "Engine settings are locked in the published app"
                    : "Settings"
                }
                className="rounded-md border border-black p-2 hover:bg-neutral-100 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                <Settings size={16} strokeWidth={ICON_STROKE} />
              </button>
            </header>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] uppercase tracking-[0.2em]">
                  Product Description
                </label>
                <div className="relative group flex items-center">
                  <button
                    onClick={() => {
                      fetch("/api/help")
                        .then((res) => res.json())
                        .then((data) => setHelpContent(data))
                        .catch(() => setHelpContent({ overviewHtml: "Failed to load help content.", guideHtml: "Failed to load help content." }));
                      setHelpTab("overview");
                      setHelpOpen(true);
                      setFlashGuide(true);
                      setTimeout(() => setFlashGuide(false), 1200);
                    }}
                    className="rounded-md border border-black p-1 hover:bg-neutral-100 transition-colors cursor-pointer"
                  >
                    <HelpCircle size={14} strokeWidth={ICON_STROKE} />
                  </button>
                  <div className="absolute right-0 bottom-full mb-2 w-64 p-3 bg-black text-white text-[11px] font-sans leading-snug rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10 hidden group-hover:block">
                    Enter a product description and click 'Classify' to receive a risk classification. Click here for more information.
                  </div>
                </div>
              </div>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1200}
                placeholder={`// Describe the product or system.
// Include: purpose, deployment context, target users,
// data inputs, decision outputs, and any automation.
// Example: "A CV-screening tool for HR teams that ranks
// applicants using historical hiring data ..."`}
                className="font-mono text-[13px] leading-6 min-h-[180px] p-4 bg-white border border-black outline-none focus:bg-[#FFFF00] focus:placeholder:text-black/60 placeholder:text-black/40 resize-none"
              />
            </div>

            {/* Action panel */}
            <div className="border border-black">
              <div className="px-3 py-1.5 border-b border-black text-[11px] uppercase tracking-[0.2em] flex items-center justify-between">
                <span>Action Panel</span>
                <span className="font-mono text-[11px]">
                  {description.length} / 1200 chars
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2 p-3">
                <button
                  onClick={() => classify()}
                  disabled={running || !description.trim()}
                  className="rounded-md border border-black bg-[#FFFF00] px-4 py-2 text-[12px] uppercase tracking-[0.18em] inline-flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-95 transition"
                >
                  <Play size={14} strokeWidth={ICON_STROKE} />
                  {running ? "Classifying…" : "Classify Product"}
                </button>
                <button
                  onClick={clearAll}
                  className="rounded-md border border-black bg-white px-4 py-2 text-[12px] uppercase tracking-[0.18em] inline-flex items-center gap-2 hover:bg-neutral-100 transition"
                >
                  <Trash2 size={14} strokeWidth={ICON_STROKE} />
                  Clear
                </button>
                <button
                  onClick={openDisagree}
                  disabled={!completedAt}
                  className={`rounded-md border border-black px-4 py-2 text-[12px] uppercase tracking-[0.18em] inline-flex items-center gap-2 disabled:opacity-30 disabled:cursor-not-allowed hover:bg-neutral-100 transition ${
                    disagreement ? "bg-[#FFFF00]" : "bg-white"
                  }`}
                >
                  <ThumbsDown size={14} strokeWidth={ICON_STROKE} />
                  {disagreement ? "Disagreement Filed" : "I Disagree"}
                </button>
              </div>
            </div>

            {/* Stage progress */}
            {(running || completedAt) && (
              <div className="border border-black">
                <div className="px-3 py-1.5 border-b border-black text-[11px] uppercase tracking-[0.2em] flex items-center justify-between">
                  <span>
                    {currentStage
                      ? STAGE_LABEL[currentStage]
                      : "Pipeline complete"}
                  </span>
                  <span className="font-mono">{overallProgress}%</span>
                </div>
                <div className="h-2 bg-white">
                  <div
                    className="h-2 bg-[#FFFF00] transition-all"
                    style={{
                      width: `${overallProgress}%`,
                      borderRight:
                        overallProgress < 100 ? "1px solid #000" : "none",
                    }}
                  />
                </div>
                <div className="grid grid-cols-3 sm:grid-cols-6">
                  {([...STAGE_ORDER] as const).map((s, i) => (
                    <div
                      key={s}
                      className={`border-t border-black px-2 py-1.5 text-[10px] uppercase tracking-[0.16em] flex items-center justify-between gap-1 ${
                        i < STAGE_ORDER.length - 1 ? "border-r" : ""
                      } ${stageStatus[s] === "running" ? "bg-[#FFFF00]" : ""}`}
                    >
                      <span className="truncate">{s}</span>
                      <span className="font-mono">
                        {stageStatus[s] === "done"
                          ? "✓"
                          : stageStatus[s] === "running"
                            ? "·"
                            : "—"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {banner && (
              <div className="border border-black bg-[#FFFF00] px-3 py-2 text-[11px] uppercase tracking-[0.2em] flex items-center justify-between">
                <span>✓ {banner}</span>
                <button
                  onClick={() => setBanner(null)}
                  className="border border-black bg-white px-1.5 py-0.5 hover:bg-neutral-100"
                  aria-label="Dismiss"
                >
                  <X size={11} strokeWidth={ICON_STROKE} />
                </button>
              </div>
            )}

            {liveError && !running && (
              <div className="border border-black bg-white">
                <div className="px-3 py-1.5 border-b border-black text-[11px] uppercase tracking-[0.2em] flex items-center justify-between bg-[#FFFF00]">
                  <span className="flex items-center gap-2">
                    <AlertTriangle size={12} strokeWidth={ICON_STROKE} />
                    Connection Error
                  </span>
                  <button
                    onClick={() => setLiveError(null)}
                    className="border border-black bg-white px-1.5 py-0.5 hover:bg-neutral-100"
                    aria-label="Dismiss"
                  >
                    <X size={11} strokeWidth={ICON_STROKE} />
                  </button>
                </div>
                <div className="p-3 text-[12px] flex flex-col gap-2">
                  <div className="font-mono">
                    ERROR: Connection failed. Check API key.
                  </div>
                  <div className="font-mono text-[11px] text-black/60 break-all">
                    {liveError}
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => classify(true)}
                      className="border border-black bg-[#FFFF00] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] hover:brightness-95 inline-flex items-center gap-1.5"
                    >
                      <Play size={12} strokeWidth={ICON_STROKE} />
                      Run Simulation
                    </button>
                    <button
                      onClick={openSettings}
                      disabled={settingsLocked}
                      title={
                        settingsLocked
                          ? "Engine settings are locked in the published app"
                          : "Open Settings"
                      }
                      className="border border-black bg-white px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] hover:bg-neutral-100 inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white"
                    >
                      <Settings size={12} strokeWidth={ICON_STROKE} />
                      {settingsLocked ? "Settings Locked" : "Open Settings"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* History panel */}
            {historyOpen && (
              <div className="border border-black">
                <div className="px-3 py-1.5 border-b border-black text-[11px] uppercase tracking-[0.2em] flex items-center justify-between">
                  <span>Run History</span>
                  <button
                    onClick={clearHistory}
                    className="border border-black px-1.5 py-0.5 hover:bg-neutral-100"
                  >
                    Clear
                  </button>
                </div>
                {history.length === 0 ? (
                  <div className="p-3 text-[12px] text-black/60">
                    No saved runs.
                  </div>
                ) : (
                  <ul className="divide-y divide-black">
                    {history.map((h) => (
                      <li
                        key={h.id}
                        className="p-3 flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-[11px] truncate">
                            {h.timestamp}
                          </div>
                          <div className="text-[12px] truncate">
                            {h.description.slice(0, 80)}
                          </div>
                          <div className="text-[10px] uppercase tracking-[0.16em] text-black/70">
                            {h.parsed.classification?.primaryRisk || "—"} ·{" "}
                            {h.parsed.classification?.primaryRole || "—"}
                          </div>
                        </div>
                        <button
                          onClick={() => loadHistory(h)}
                          className="border border-black px-2 py-1 text-[10px] uppercase tracking-[0.16em] hover:bg-neutral-100 shrink-0"
                        >
                          Load
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* RESULTS — Signals matrix */}
            {parsed.signals.length > 0 && (
              <div className="border border-black flex flex-col">
                <div className="px-3 py-1.5 border-b border-black text-[11px] uppercase tracking-[0.2em] flex items-center justify-between">
                  <span>Signals Quality Matrix</span>
                  <span className="font-mono">stage 01</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[12px] min-w-[500px]">
                    <thead>
                      <tr className="border-b border-black bg-neutral-50">
                        <th className="text-left p-2 uppercase tracking-[0.16em] text-[10px] font-medium w-[40px]">
                          #
                        </th>
                        <th className="text-left p-2 uppercase tracking-[0.16em] text-[10px] font-medium">
                          Dimension / Criteria
                        </th>
                        <th className="text-left p-2 uppercase tracking-[0.16em] text-[10px] font-medium w-[80px]">
                          Score
                        </th>
                        <th className="text-left p-2 uppercase tracking-[0.16em] text-[10px] font-medium">
                          Notes / Details
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.signals.map((r, i) => (
                        <tr key={i} className={i ? "border-t border-black" : ""}>
                          <td className="p-2 align-top font-mono text-[10px] text-black/60">{r.id}</td>
                          <td className="p-2 align-top font-medium">{r.dimension}</td>
                          <td className="p-2 align-top">
                            <ScoreChip score={r.score} />
                          </td>
                          <td className="p-2 align-top text-black/80 text-[11.5px] leading-5">
                            <FormatText text={r.note} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {parsed.signalsSummary && (
                  <div className="border-t border-black bg-[#FFFF00] p-4 flex flex-col gap-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <div className="text-[10px] uppercase tracking-[0.2em] text-black/60 mb-0.5">Overall Clarity Confidence</div>
                        <div className="font-mono text-lg font-bold">{parsed.signalsSummary.confidence || "—"}</div>
                      </div>
                      {parsed.signalsSummary.status && (
                        <div>
                          <div className="text-[10px] uppercase tracking-[0.2em] text-black/60 mb-0.5">Status</div>
                          <div className="font-medium text-[13px] uppercase tracking-wide">{parsed.signalsSummary.status || "—"}</div>
                        </div>
                      )}
                    </div>
                    {parsed.signalsSummary.reasoning && (
                      <div className="border-t border-black/20 pt-3">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-black/60 mb-1">Confidence Reasoning</div>
                        <div className="text-[12.5px] leading-relaxed"><FormatText text={parsed.signalsSummary.reasoning} /></div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* DISCLAIMER */}
            <div className="border-2 border-[#FFFF00] bg-[#FFFFE0] p-3 text-[12px] text-black leading-relaxed">
              <div className="text-[12px] uppercase tracking-[0.2em] font-bold mb-1.5 flex items-center gap-2">
                ⚠️ DISCLAIMER
              </div>
              <p className="mb-2">
                Please note that the results generated by this Artificial Intelligence engine are for
                informational purposes only.
              </p>
              <p className="mb-2">
                The outputs generated are not to be considered as legal advice.
                Please consult your own legal counsel for confirmation of the
                risk classification and resultant obligations.
              </p>
              <p>
                The results, output, and other content are generated using an
                LLM and do not represent the European Commission's assessment of
                your situation, or of your obligations under the AI Act.
              </p>
            </div>

            {/* RESULTS — Classification headline */}
            {parsed.classification && (
              <div className="border-[3px] border-[#FFFF00] shadow-[4px_4px_0_0_#000] ring-1 ring-black">
                <div className="px-3 py-1.5 border-b border-black bg-[#FFFF00] text-[11px] uppercase tracking-[0.2em] flex items-center justify-between">
                  <span className="font-medium">Primary Classification</span>
                  <span className="font-mono">stage 02</span>
                </div>
                <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4 bg-white">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-black/60">
                      Risk
                    </div>
                    <div className="text-3xl sm:text-4xl font-medium uppercase tracking-tight mt-1 inline-block bg-[#FFFF00] px-2 border border-black">
                      {parsed.classification.primaryRisk || "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.2em] text-black/60">
                      Role
                    </div>
                    <div className="text-3xl sm:text-4xl font-medium uppercase tracking-tight mt-1 inline-block bg-[#FFFF00] px-2 border border-black">
                      {parsed.classification.primaryRole || "—"}
                    </div>
                  </div>
                  {parsed.classification.rationale && (
                    <div className="sm:col-span-2 border-t border-black pt-3 text-[13px] leading-6">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-black/60 mb-1">
                        Rationale
                      </div>
                      <FormatText text={parsed.classification.rationale} />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* RESULTS — Map accordion */}
            {parsed.map.length > 0 && (
              <div className="border border-black">
                <div className="px-3 py-1.5 border-b border-black text-[11px] uppercase tracking-[0.2em] flex items-center justify-between">
                  <span>Mapping to EU AI Act</span>
                  <span className="font-mono">
                    stage 03 · {parsed.map.length}
                  </span>
                </div>
                <ul>
                  {parsed.map.map((m, i) => {
                    const open = !!openMap[i];
                    return (
                      <li key={i} className={i ? "border-t border-black" : ""}>
                        <button
                          onClick={() =>
                            setOpenMap((o) => ({ ...o, [i]: !o[i] }))
                          }
                          className="w-full text-left p-3 flex items-start justify-between gap-3 hover:bg-neutral-100"
                        >
                          <div className="min-w-0">
                            <div className="text-[10px] uppercase tracking-[0.2em] text-black/60">
                              {m.ref}
                            </div>
                            <div className="text-[13px] font-mono truncate">
                              "{m.snippet}"
                            </div>
                          </div>
                          {open ? (
                            <ChevronDown size={16} strokeWidth={ICON_STROKE} />
                          ) : (
                            <ChevronRight size={16} strokeWidth={ICON_STROKE} />
                          )}
                        </button>
                        {open && (
                          <div className="px-3 pb-3 text-[13px] leading-6">
                            <p><FormatText text={m.reasoning} /></p>
                            {m.articleSnippet && (
                              <div className="mt-3 pl-3 border-l-2 border-neutral-300">
                                <p className="text-[12px] italic text-black/80 font-serif leading-relaxed">
                                  "{m.articleSnippet}"
                                </p>
                              </div>
                            )}
                            {m.url && (
                              <a
                                href={m.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="mt-2 inline-flex items-center gap-1 underline underline-offset-2 text-[12px]"
                              >
                                {m.url}
                                <ExternalLink
                                  size={12}
                                  strokeWidth={ICON_STROKE}
                                />
                              </a>
                            )}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* RESULTS — Warnings (yellow border) */}
            {parsed.warnings.length > 0 && (
              <div className="border-2 border-[#FFFF00]">
                <button
                  onClick={() => setWarningsOpen((o) => !o)}
                  className="w-full px-3 py-1.5 border-b border-[#FFFF00] text-[11px] uppercase tracking-[0.2em] flex items-center justify-between bg-[#FFFF00]/10"
                >
                  <span className="inline-flex items-center gap-2">
                    <AlertTriangle size={14} strokeWidth={ICON_STROKE} />
                    Risk Transformation Warnings
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="font-mono">
                      stage 04 · {parsed.warnings.length}
                    </span>
                    {warningsOpen ? (
                      <ChevronDown size={14} strokeWidth={ICON_STROKE} />
                    ) : (
                      <ChevronRight size={14} strokeWidth={ICON_STROKE} />
                    )}
                  </span>
                </button>
                {warningsOpen && (
                  <ul>
                    {parsed.warnings.map((w, i) => (
                      <li
                        key={i}
                        className={`p-3 ${i ? "border-t border-[#FFFF00]" : ""}`}
                      >
                        <div className="text-[12px] uppercase tracking-[0.16em] font-medium">
                          {w.title}
                        </div>
                        <div className="text-[13px] leading-6 text-black/80 mt-1">
                          <FormatText text={w.detail} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* RESULTS — Info */}
            {parsed.info.length > 0 && (
              <div className="border border-black">
                <button
                  onClick={() => setInfoOpen((o) => !o)}
                  className="w-full px-3 py-1.5 border-b border-black text-[11px] uppercase tracking-[0.2em] flex items-center justify-between"
                >
                  <span className="inline-flex items-center gap-2">
                    <Info size={14} strokeWidth={ICON_STROKE} />
                    Information & Obligations
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="font-mono">
                      stage 05 · {parsed.info.length}
                    </span>
                    {infoOpen ? (
                      <ChevronDown size={14} strokeWidth={ICON_STROKE} />
                    ) : (
                      <ChevronRight size={14} strokeWidth={ICON_STROKE} />
                    )}
                  </span>
                </button>
                {infoOpen && (
                  <ul>
                    {parsed.info.map((it, i) => (
                      <li
                        key={i}
                        className={`p-3 ${i ? "border-t border-black" : ""}`}
                      >
                        <div className="text-[12px] uppercase tracking-[0.16em] font-medium">
                          {it.title}
                        </div>
                        <div className="text-[13px] leading-6 text-black/80 mt-1">
                          <FormatText text={it.detail} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Reports (stage 06) */}
            {completedAt && (
              <div className="border border-black">
                <div className="px-3 py-1.5 border-b border-black text-[11px] uppercase tracking-[0.2em] flex items-center justify-between">
                  <span>Compliance Reports</span>
                  <span className="font-mono">stage 06</span>
                </div>
                <div className="p-3 flex flex-wrap items-center gap-2">
                  <button
                    onClick={downloadMd}
                    className="rounded-md border border-black bg-[#FFFF00] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] inline-flex items-center gap-2 hover:brightness-95"
                  >
                    <Download size={13} strokeWidth={ICON_STROKE} />
                    Download Markdown Report
                  </button>
                  <button
                    onClick={downloadHtmlReport}
                    className="rounded-md border border-black bg-white px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] inline-flex items-center gap-2 hover:bg-neutral-100"
                  >
                    <Download size={13} strokeWidth={ICON_STROKE} />
                    Download HTML Report
                  </button>
                  <button
                    onClick={openPreview}
                    className="rounded-md border border-black bg-white px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] inline-flex items-center gap-2 hover:bg-neutral-100"
                  >
                    <FileText size={13} strokeWidth={ICON_STROKE} />
                    Preview Report
                  </button>
                  <button
                    onClick={() => openSettings()}
                    className="rounded-md border border-black bg-white px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] inline-flex items-center gap-2 hover:bg-neutral-100"
                  >
                    <Settings size={13} strokeWidth={ICON_STROKE} />
                    Edit Templates
                  </button>
                  <span className="ml-auto text-[11px] font-mono text-black/60">
                    completed {completedAt.slice(11, 19)}
                  </span>
                </div>
              </div>
            )}
          </section>

          {/* RIGHT — Terminal */}
          <section className="p-6 flex flex-col gap-3">
            <header className="flex items-center justify-between">
              <h2 className="text-[12px] uppercase tracking-[0.22em]">
                Engine Output Stream
              </h2>
              <span className="text-[11px] uppercase tracking-[0.2em] flex items-center gap-1.5">
                <span
                  className={`inline-block w-2 h-2 border border-black ${running ? "bg-[#FFFF00]" : "bg-white"}`}
                />
                {running ? "Streaming" : "Idle"}
              </span>
            </header>

            <div className="border border-black flex-1 flex flex-col min-h-[480px]">
              <div className="flex items-center justify-between border-b border-black px-3 py-1.5 text-[11px] uppercase tracking-[0.2em]">
                <span>/engine</span>
                <span className="font-mono normal-case tracking-normal text-[11px]">
                  {logs.length} lines
                </span>
              </div>
              <div
                ref={termRef}
                className="font-mono text-[12.5px] leading-6 bg-black text-white p-3 overflow-auto flex-1 min-h-[420px] max-h-[640px]"
              >
                {logs.map((l, i) => (
                  <div key={i} className="whitespace-pre-wrap">
                    {l.kind === "user" ? (
                      <span className="text-[#FFFF00]">{l.text}</span>
                    ) : l.kind === "stage" ? (
                      <span className="text-[#FFFF00]">{l.text}</span>
                    ) : l.kind === "system" ? (
                      <span className="text-white">{l.text}</span>
                    ) : (
                      <span className="text-white/90">{l.text}</span>
                    )}
                  </div>
                ))}
                <div className="flex items-center">
                  <span className="text-[#FFFF00]">&gt;&nbsp;</span>
                  <span className="cursor-blink h-[1em]" />
                </div>
              </div>
            </div>

            <footer className="text-[11px] uppercase tracking-[0.2em] flex items-center justify-between">
              <span>Session 0x1A</span>
              <span suppressHydrationWarning>UTC {clock}</span>
            </footer>
          </section>
        </div>
      </div>

      {/* Preview modal */}
      {previewOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setPreviewOpen(false)}
        >
          <div
            className="bg-white border border-black w-full max-w-5xl h-[88vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-black px-3 py-2 text-[11px] uppercase tracking-[0.2em]">
              <span>Report Preview · {deriveProductName(description)}</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={downloadHtmlReport}
                  className="border border-black px-2 py-0.5 hover:bg-neutral-100 inline-flex items-center gap-1"
                >
                  <Download size={12} strokeWidth={ICON_STROKE} /> .html
                </button>
                <button
                  onClick={() => setPreviewOpen(false)}
                  className="border border-black px-2 py-0.5 hover:bg-neutral-100 inline-flex items-center gap-1"
                >
                  <X size={12} strokeWidth={ICON_STROKE} /> Close
                </button>
              </div>
            </div>
            <iframe
              title="report-preview"
              className="flex-1 w-full bg-white"
              sandbox=""
              srcDoc={compileHtml(htmlTemplate, {
                description,
                parsed,
                disagreement,
                generatedAt: completedAt ?? new Date().toISOString(),
              })}
            />
          </div>
        </div>
      )}

      {/* Disagreement modal */}
      {disagreeOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setDisagreeOpen(false)}
        >
          <div
            className="bg-white border border-black w-full max-w-3xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-black px-3 py-2 text-[11px] uppercase tracking-[0.2em]">
              <span>File Disagreement</span>
              <button
                onClick={() => setDisagreeOpen(false)}
                className="border border-black px-2 py-0.5 hover:bg-neutral-100 inline-flex items-center gap-1"
              >
                <X size={12} strokeWidth={ICON_STROKE} /> Close
              </button>
            </div>
            <div className="p-4 grid grid-cols-1 gap-3">
              <label className="text-[10px] uppercase tracking-[0.2em]">
                Reason
              </label>
              <textarea
                value={disagreeReason}
                onChange={(e) => setDisagreeReason(e.target.value)}
                placeholder="// Why is this classification incorrect?"
                className="font-mono text-[12px] leading-5 min-h-[180px] p-3 bg-white border border-black outline-none focus:bg-[#FFFF00]/30 resize-none"
              />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-[0.2em]">
                    Proposed Risk
                  </label>
                  <input
                    value={disagreeRisk}
                    onChange={(e) => setDisagreeRisk(e.target.value)}
                    placeholder="e.g. LIMITED RISK"
                    className="mt-1 font-mono text-[12px] w-full p-2 bg-white border border-black outline-none focus:bg-[#FFFF00]/30"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-[0.2em]">
                    Proposed Role
                  </label>
                  <input
                    value={disagreeRole}
                    onChange={(e) => setDisagreeRole(e.target.value)}
                    placeholder="e.g. DEPLOYER"
                    className="mt-1 font-mono text-[12px] w-full p-2 bg-white border border-black outline-none focus:bg-[#FFFF00]/30"
                  />
                </div>
              </div>
              {parsed.map.length > 0 && (
                <div className="mt-2 pt-2 border-t border-black">
                  <label className="text-[10px] uppercase tracking-[0.2em] mb-2 block">
                    Mapping Snippet Feedback
                  </label>
                  <div className="max-h-[240px] overflow-y-auto pr-1 flex flex-col gap-3">
                    {parsed.map.map((m, i) => (
                      <div key={i} className="flex flex-col gap-1">
                        <div className="text-[11px] font-mono font-bold bg-neutral-100 p-1">{m.ref}</div>
                        <div className="text-[10px] italic line-clamp-2 px-1">"{m.snippet}"</div>
                        <input
                          value={disagreeSnippets[m.ref] || ""}
                          onChange={(e) => setDisagreeSnippets(prev => ({...prev, [m.ref]: e.target.value}))}
                          placeholder="Comment on this snippet..."
                          className="font-mono text-[11px] w-full p-1.5 bg-white border border-black outline-none focus:bg-[#FFFF00]/30"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-black">
                {disagreement && (
                  <button
                    onClick={() => {
                      setDisagreement(null);
                      setDisagreeOpen(false);
                    }}
                    className="border border-black px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] hover:bg-neutral-100"
                  >
                    Withdraw
                  </button>
                )}
                <button
                  onClick={submitDisagree}
                  disabled={!disagreeReason.trim()}
                  className="border border-black bg-[#FFFF00] px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-95"
                >
                  Submit Disagreement
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings slide-over drawer */}
      {settingsOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex justify-end"
          onClick={() => setSettingsOpen(false)}
        >
          <aside
            className="bg-white border-l border-black w-full max-w-[640px] h-full flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-black px-4 py-2.5 text-[11px] uppercase tracking-[0.22em]">
              <div className="flex items-center gap-2">
                <Settings size={14} strokeWidth={ICON_STROKE} />
                <span>Engine Settings</span>
                <ChevronRight size={11} strokeWidth={ICON_STROKE} />
                <span className="bg-[#FFFF00] px-1.5">Config</span>
              </div>
              <button
                onClick={() => setSettingsOpen(false)}
                className="border border-black px-2 py-0.5 hover:bg-neutral-100 inline-flex items-center gap-1"
                aria-label="Close settings"
              >
                <X size={12} strokeWidth={ICON_STROKE} /> Close
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4 flex flex-col gap-4 text-[12px]">
              {/* API Key + Provider */}
              <div className="border border-black">
                <div className="px-3 py-1.5 border-b border-black text-[11px] uppercase tracking-[0.2em] flex items-center justify-between">
                  <span>LLM API Key</span>
                  <span className="font-mono normal-case tracking-normal text-[11px] text-black/60">
                    {draftConfig.apiKey
                      ? `${draftConfig.apiKey.length} chars`
                      : "not set"}
                  </span>
                </div>
                <div className="p-3 grid grid-cols-1 sm:grid-cols-[1fr_180px] gap-2">
                  <input
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
                    value={draftConfig.apiKey}
                    onChange={(e) =>
                      setDraftConfig((c) => ({ ...c, apiKey: e.target.value }))
                    }
                    placeholder="sk-…  /  AIza…"
                    className="font-mono text-[12px] p-2 bg-white border border-black outline-none focus:bg-[#FFFF00]/30"
                  />
                  <select
                    value={draftConfig.apiProvider}
                    onChange={(e) =>
                      setDraftConfig((c) => ({
                        ...c,
                        apiProvider: e.target.value as ApiProvider,
                      }))
                    }
                    className="border border-black bg-white px-2 py-2 text-[11px] uppercase tracking-[0.16em] outline-none focus:bg-[#FFFF00]"
                  >
                    <option value="GEMINI">Gemini API</option>
                    <option value="OPENAI">OpenAI API</option>
                  </select>
                </div>
              </div>

              {/* Signals Rules */}
              <ConfigTextArea
                label="Signals Matrix Rules"
                value={draftConfig.signalsRules}
                onChange={(v) =>
                  setDraftConfig((c) => ({ ...c, signalsRules: v }))
                }
                onReset={() =>
                  setDraftConfig((c) => ({
                    ...c,
                    signalsRules: DEFAULT_SIGNALS_RULES,
                  }))
                }
                minH={160}
              />

              {/* Markdown Template */}
              <ConfigTextArea
                label="Markdown Report Template"
                value={draftConfig.mdTemplate}
                onChange={(v) =>
                  setDraftConfig((c) => ({ ...c, mdTemplate: v }))
                }
                onReset={() =>
                  setDraftConfig((c) => ({
                    ...c,
                    mdTemplate: DEFAULT_MD_TEMPLATE,
                  }))
                }
                minH={160}
                hint="Placeholders: {{primary_risk}}, {{primary_role}}, {{signals_table}}, {{mapping_list}}, {{warnings_list}}, {{obligations_list}}, {{product_name}}, {{generated_at}}"
              />

              {/* HTML Template */}
              <ConfigTextArea
                label="HTML Report Template"
                value={draftConfig.htmlTemplate}
                onChange={(v) =>
                  setDraftConfig((c) => ({ ...c, htmlTemplate: v }))
                }
                onReset={() =>
                  setDraftConfig((c) => ({
                    ...c,
                    htmlTemplate: DEFAULT_HTML_TEMPLATE,
                  }))
                }
                minH={200}
                hint="Placeholders: {{mapping_items}}, {{disagreement_block}}, {{primary_risk}}, {{primary_role}} …"
              />
            </div>

            <div className="border-t border-black p-3 flex items-center justify-between gap-2">
              <button
                onClick={resetConfig}
                className="border border-black bg-white px-3 py-2 text-[11px] uppercase tracking-[0.18em] hover:bg-neutral-100"
              >
                Reset to Default
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setSettingsOpen(false)}
                  className="border border-black bg-white px-3 py-2 text-[11px] uppercase tracking-[0.18em] hover:bg-neutral-100"
                >
                  Cancel
                </button>
                <button
                  onClick={saveConfig}
                  className="border border-black bg-[#FFFF00] px-4 py-2 text-[11px] uppercase tracking-[0.18em] hover:brightness-95"
                >
                  Save Configuration
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* Help modal */}
      {helpOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="bg-white border border-black w-full max-w-2xl flex flex-col max-h-[80vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-black px-3 py-2 text-[11px] uppercase tracking-[0.2em] bg-white">
              <div className="flex items-center gap-4">
                <span>Help & Information</span>
                <div className="flex gap-2">
                  <button 
                    onClick={() => setHelpTab("overview")}
                    className={`px-2 py-1 transition-colors ${helpTab === "overview" ? "bg-[#FFFF00] border border-black" : "hover:bg-neutral-100 border border-transparent"}`}
                  >
                    Overview
                  </button>
                  <button 
                    onClick={() => setHelpTab("guide")}
                    className={`px-2 py-1 transition-colors duration-700 ${helpTab === "guide" ? "bg-[#FFFF00] border border-black" : flashGuide ? "bg-[#FFFF00]/60 border border-black" : "hover:bg-neutral-100 border border-transparent"}`}
                  >
                    User Guide
                  </button>
                </div>
              </div>
              <button
                onClick={() => setHelpOpen(false)}
                className="border border-black px-2 py-0.5 hover:bg-neutral-100 inline-flex items-center gap-1"
              >
                <X size={12} strokeWidth={ICON_STROKE} /> Close
              </button>
            </div>
            <div 
              className="p-4 overflow-y-auto w-full h-full"
              dangerouslySetInnerHTML={{ __html: helpContent ? (helpTab === "overview" ? helpContent.overviewHtml : helpContent.guideHtml) : "" }}
            />
          </div>
        </div>
      )}
    </main>
  );
}

function ScoreChip({ score }: { score: string }) {
  const val = parseInt(score, 10);
  const isHigh = !isNaN(val) && val >= 60;
  const isLow = !isNaN(val) && val <= 30;
  const style = isHigh
    ? "bg-[#FFFF00] border-black"
    : isLow
      ? "bg-black text-white border-black"
      : "bg-white border-black";
      
  return (
    <span
      className={`inline-block border px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] font-mono ${style}`}
    >
      {score}
    </span>
  );
}

function ConfigTextArea({
  label,
  value,
  onChange,
  onReset,
  minH = 140,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onReset: () => void;
  minH?: number;
  hint?: string;
}) {
  return (
    <div className="border border-black">
      <div className="px-3 py-1.5 border-b border-black text-[11px] uppercase tracking-[0.2em] flex items-center justify-between">
        <span>{label}</span>
        <button
          onClick={onReset}
          className="border border-black bg-white px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] hover:bg-neutral-100"
        >
          Reset
        </button>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        style={{ minHeight: minH }}
        className="font-mono text-[11.5px] leading-5 w-full p-3 bg-white outline-none focus:bg-[#FFFF00]/20 resize-y block"
      />
      {hint && (
        <div className="border-t border-black px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-black/70 font-mono normal-case">
          {hint}
        </div>
      )}
    </div>
  );
}
