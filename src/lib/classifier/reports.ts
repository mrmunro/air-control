import type { Parsed } from "./parser";

export type Disagreement = {
  reason: string;
  proposedRisk?: string;
  proposedRole?: string;
  filedAt: string;
  snippetComments?: Record<string, string>;
} | null;

export type ReportContext = {
  description: string;
  parsed: Parsed;
  disagreement: Disagreement;
  generatedAt: string;
};

const esc = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );

// ---------- product name heuristic ----------
export function deriveProductName(description: string): string {
  const first = description.trim().split(/\n/)[0] ?? "";
  const m = first.match(/^([A-Z][\w\s\-/]{2,60}?)(?:[:.\u2014\-]|$)/);
  if (m) return m[1].trim();
  return first.slice(0, 60).trim() || "Untitled System";
}

// ---------- Markdown block builders ----------
function mdSignalsTable(p: Parsed): string {
  if (!p.signals.length) return "_No signals captured._";
  const head = "| # | Dimension / Criteria | Score | Notes / Details |\n| --- | --- | --- | --- |";
  const body = p.signals
    .map(
      (r) => `| ${r.id} | ${r.dimension} | ${r.score} | ${r.note.replace(/\|/g, "\\|")} |`,
    )
    .join("\n");
  let res = `${head}\n${body}`;
  if (p.signalsSummary) {
    res += `\n\n**OVERALL CLARITY CONFIDENCE:** ${p.signalsSummary.confidence}\n\n**STATUS:** ${p.signalsSummary.status}`;
  }
  return res;
}
function mdMappingList(p: Parsed): string {
  if (!p.map.length) return "_No mappings produced._";
  return p.map
    .map(
      (m) =>
        `- **${m.ref}** — "${m.snippet}"\n  - ${m.reasoning}${m.url ? `\n  - ${m.url}` : ""}`,
    )
    .join("\n");
}
function mdTitledList(items: Parsed["warnings"]): string {
  if (!items.length) return "_None._";
  return items.map((i) => `- **${i.title}** — ${i.detail}`).join("\n");
}
function mdDisagreement(d: Disagreement): string {
  if (!d) return "";
  const lines: string[] = [];
  lines.push(`**Filed:** ${d.filedAt}`);
  if (d.proposedRisk) lines.push(`**Proposed Risk:** ${d.proposedRisk}`);
  if (d.proposedRole) lines.push(`**Proposed Role:** ${d.proposedRole}`);
  lines.push("");
  lines.push(d.reason);
  if (d.snippetComments && Object.keys(d.snippetComments).length > 0) {
    lines.push("\n### Snippet Comments");
    for (const [ref, comment] of Object.entries(d.snippetComments)) {
      lines.push(`- **${ref}:** ${comment}`);
    }
  }
  return lines.join("\n");
}

// ---------- HTML block builders ----------
function htmlSignalRows(p: Parsed): string {
  if (!p.signals.length)
    return `<tr><td colspan="4" class="muted">No signals captured.</td></tr>`;
  return p.signals
    .map(
      (r) =>
        `<tr><td style="font-family:monospace;font-size:11px;">${esc(r.id)}</td><td><strong>${esc(r.dimension)}</strong></td><td><span class="pill" style="border-radius:0;">${esc(r.score)}</span></td><td>${esc(r.note).replace(/&lt;br\s*\/?&gt;/gi, '<br />')}</td></tr>`,
    )
    .join("\n      ");
}
function htmlMappingItems(p: Parsed): string {
  if (!p.map.length) return `<p class="muted">No mappings produced.</p>`;
  return p.map
    .map(
      (m) => `<div class="map-item">
    <div class="ref">${esc(m.ref)}</div>
    <div class="snippet">"${esc(m.snippet)}"</div>
    <div>${esc(m.reasoning)}</div>
    ${m.articleSnippet ? `<div style="margin-top:8px;padding-left:10px;border-left:2px solid #ccc;font-style:italic;font-size:12px;color:#333;">"${esc(m.articleSnippet)}"</div>` : ""}
    ${m.url ? `<div style="margin-top:8px;"><a href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">${esc(m.url)}</a></div>` : ""}
  </div>`,
    )
    .join("\n  ");
}
function htmlWarningItems(p: Parsed): string {
  if (!p.warnings.length) return `<p class="muted">No warnings.</p>`;
  return p.warnings
    .map(
      (w) =>
        `<div class="warn"><div class="t">${esc(w.title)}</div><div>${esc(w.detail)}</div></div>`,
    )
    .join("\n  ");
}
function htmlInfoItems(p: Parsed): string {
  if (!p.info.length) return `<p class="muted">No obligations listed.</p>`;
  return p.info
    .map(
      (i) =>
        `<div class="info"><div class="t">${esc(i.title)}</div><div>${esc(i.detail)}</div></div>`,
    )
    .join("\n  ");
}
function htmlDisagreementBlock(d: Disagreement): string {
  if (!d) return `<p class="muted">No disagreement filed.</p>`;
  const meta: string[] = [`<strong>Filed:</strong> ${esc(d.filedAt)}`];
  if (d.proposedRisk)
    meta.push(`<strong>Proposed Risk:</strong> ${esc(d.proposedRisk)}`);
  if (d.proposedRole)
    meta.push(`<strong>Proposed Role:</strong> ${esc(d.proposedRole)}`);
    
  let html = `<div class="disagreement"><div class="muted">${meta.join(" · ")}</div><p>${esc(d.reason)}</p>`;
  
  if (d.snippetComments && Object.keys(d.snippetComments).length > 0) {
    html += `<div style="margin-top: 12px; font-size: 12px;"><strong>Snippet Comments:</strong><ul style="margin: 4px 0 0 0; padding-left: 20px;">`;
    for (const [ref, comment] of Object.entries(d.snippetComments)) {
      html += `<li style="margin-bottom: 4px;"><strong>${esc(ref)}:</strong> ${esc(comment)}</li>`;
    }
    html += `</ul></div>`;
  }
  
  html += `</div>`;
  return html;
}

// ---------- Generic template compiler ----------
function applyTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k: string) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? vars[k] : "",
  );
}

// ---------- Disclaimer (always injected into reports) ----------
const DISCLAIMER_MD = `**⚠️ DISCLAIMER.** 
Please note that the results generated by this Artificial Intelligence engine are for informational purposes only.

The outputs generated are not to be considered as legal advice. Please consult your own legal counsel for confirmation of the risk classification and resultant obligations.

The results, output, and other content are generated using an LLM and do not represent the European Commission's assessment of your situation, or of your obligations under the AI Act.`;

const DISCLAIMER_HTML = `<div style="border:2px solid #ffff00;background:#ffffe0;padding:12px 14px;margin:12px 0 16px;font-size:12px;line-height:1.55;">
  <div style="font-size:12px;text-transform:uppercase;letter-spacing:.2em;font-weight:bold;margin-bottom:6px;">⚠️ Disclaimer</div>
  <p style="margin:0 0 6px;">Please note that the results generated by this Artificial Intelligence engine are for informational purposes only.</p>
  <p style="margin:0 0 6px;">The outputs generated are not to be considered as legal advice. Please consult your own legal counsel for confirmation of the risk classification and resultant obligations.</p>
  <p style="margin:0;">The results, output, and other content are generated using an LLM and do not represent the European Commission's assessment of your situation, or of your obligations under the AI Act.</p>
</div>`;

function injectDisclaimerMd(out: string): string {
  // Strip out old cached disclaimers
  out = out.replace(/(> )?\*\*(⚠️ )?DISCLAIMER\.?\*\*[\s\S]*?under the AI Act\./i, "");
  if (out.includes("⚠️ DISCLAIMER.")) return out; // Already injected
  
  // insert after first H1 line if present, else prepend
  const lines = out.split("\n");
  const idx = lines.findIndex((l) => /^#\s+/.test(l));
  if (idx >= 0) {
    lines.splice(idx + 1, 0, "", DISCLAIMER_MD);
    return lines.join("\n");
  }
  return `${DISCLAIMER_MD}\n\n${out}`;
}

function injectDisclaimerHtml(out: string): string {
  // Strip out old cached HTML disclaimers
  out = out.replace(/<div[^>]*>[\s\S]*?(?:Disclaimer|⚠️ Disclaimer)<\/div>[\s\S]*?under the AI Act\.<\/p>\s*<\/div>/i, "");
  
  if (out.includes(">⚠️ Disclaimer<")) return out; // Already injected
  
  const m = out.match(/<\/h1>/i);
  if (m && m.index !== undefined) {
    const insertAt = m.index + m[0].length;
    return (
      out.slice(0, insertAt) + "\n" + DISCLAIMER_HTML + out.slice(insertAt)
    );
  }
  const bodyMatch = out.match(/<body[^>]*>/i);
  if (bodyMatch && bodyMatch.index !== undefined) {
    const insertAt = bodyMatch.index + bodyMatch[0].length;
    return (
      out.slice(0, insertAt) + "\n" + DISCLAIMER_HTML + out.slice(insertAt)
    );
  }
  return DISCLAIMER_HTML + out;
}

// ---------- Simple Markdown to HTML ----------
function parseAudienceSections(md: string): { title: string, body: string }[] {
  if (!md) return [];
  // Match any heading level 1-4, or ** bold **, matching exactly "Engineering", "Legal", or "Executive"
  // Example matches: "## Engineering", "### Legal Section", "**Executive:**", "Engineering:"
  const regex = /^(?:#{1,4}\s+|\*\*\s*)?(Engineering|Legal|Executive)(?:\s+Section)?(?:\s*\*\*)?:?\s*$/gim;
  
  const parts = md.split(regex);
  const sections: { title: string, body: string }[] = [];
  
  if (parts.length >= 3) {
    // parts[0] is preamble. [1] is title, [2] is body, [3] is title, etc.
    for (let i = 1; i < parts.length; i += 2) {
      sections.push({
        title: parts[i].trim(),
        body: (parts[i+1] || "").trim()
      });
    }
    return sections;
  }
  
  // Fallback to splitting by heading 2 or 3
  const genericParts = md.split(/^#{2,3}\s+/m).filter((s) => s.trim().length > 0);
  for (const part of genericParts) {
    const lines = part.trim().split("\n");
    let title = lines[0].trim().replace(/\*\*|__/g, "");
    sections.push({ title, body: lines.slice(1).join("\n").trim() });
  }
  return sections;
}

function formatAudienceSummariesMd(md: string): string {
  if (!md) return "";
  const sections = parseAudienceSections(md);
  if (sections.length === 0) return "";
  
  let finalMd = "## Target Audience Summaries\n\n";
  for (const section of sections) {
    finalMd += `- **${section.title}**\n`;
    finalMd += section.body.split("\n").map(l => `  ${l}`).join("\n") + "\n\n";
  }
  return finalMd.trim();
}

function simpleMdToHtml(md: string): string {
  if (!md) return "";
  
  const sections = parseAudienceSections(md);
  if (sections.length === 0) return "";
  
  let finalHtml = "<h2>Target Audience Summaries</h2>\n";
  
  for (const section of sections) {
    let html = esc(section.body);
    html = html.replace(/^###\s+(.*)$/gm, '<h3>$1</h3>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^[\-\*]\s+(.*)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>(?:\n\s*<li>.*<\/li>)*)/g, '<ul style="margin-top:8px;">\n$1\n</ul>');
    html = html.replace(/\n\n/g, '<br /><br />');
    
    finalHtml += `<div class="info" style="margin-bottom:16px;">
      <div class="t">${esc(section.title)}</div>
      <div style="margin-top:8px;">${html}</div>
    </div>\n`;
  }
  
  return `<div style="margin-bottom:24px;">\n${finalHtml}\n</div>`;
}

// ---------- Public compilers ----------
export function compileMarkdown(template: string, ctx: ReportContext): string {
  const p = ctx.parsed;
  const vars: Record<string, string> = {
    product_name: deriveProductName(ctx.description),
    product_description: ctx.description.replace(/\n/g, "\n> "),
    generated_at: ctx.generatedAt,
    primary_risk: p.classification?.primaryRisk ?? "—",
    primary_role: p.classification?.primaryRole ?? "—",
    classification_rationale: p.classification?.rationale ?? "",
    signals_table: mdSignalsTable(p),
    mapping_list: mdMappingList(p),
    warnings_list: mdTitledList(p.warnings),
    obligations_list: mdTitledList(p.info),
    audience_summaries: p.reportsOutput ? formatAudienceSummariesMd(p.reportsOutput) : "",
    disagreement_content: mdDisagreement(ctx.disagreement),
  };
  return injectDisclaimerMd(applyTemplate(template, vars));
}

export function compileHtml(template: string, ctx: ReportContext): string {
  const p = ctx.parsed;
  const vars: Record<string, string> = {
    product_name: esc(deriveProductName(ctx.description)),
    product_description: esc(ctx.description),
    generated_at: esc(ctx.generatedAt),
    primary_risk: esc(p.classification?.primaryRisk ?? "—"),
    primary_role: esc(p.classification?.primaryRole ?? "—"),
    classification_rationale: esc(p.classification?.rationale ?? ""),
    signals_table_rows: htmlSignalRows(p),
    signals_summary_block: p.signalsSummary 
      ? `<div style="margin-top: 16px; padding: 16px; background: #ffff00; border: 1px solid #000;">
           <div style="font-size:10px;text-transform:uppercase;letter-spacing:.2em;color:#555;">Overall Clarity Confidence</div>
           <div style="font-size:20px;font-weight:bold;font-family:monospace;">${esc(p.signalsSummary.confidence)}</div>
           <div style="font-size:10px;text-transform:uppercase;letter-spacing:.2em;color:#555;margin-top:12px;">Confidence Reasoning</div>
           <div style="font-size:13px;line-height:1.4;">${esc(p.signalsSummary.reasoning ?? p.signalsSummary.status ?? "")}</div>
         </div>`
      : "",
    mapping_items: htmlMappingItems(p),
    warnings_items: htmlWarningItems(p),
    obligations_items: htmlInfoItems(p),
    audience_summaries: p.reportsOutput ? simpleMdToHtml(p.reportsOutput) : "",
    disagreement_block: htmlDisagreementBlock(ctx.disagreement),
  };
  return injectDisclaimerHtml(applyTemplate(template, vars));
}

// ---------- Legacy helpers (kept for compatibility) ----------
export function toMarkdown(description: string, p: Parsed): string {
  return compileMarkdown(
    // minimal default if caller doesn't supply template
    "{{signals_table}}",
    {
      description,
      parsed: p,
      disagreement: null,
      generatedAt: new Date().toISOString(),
    },
  );
}
export function toHtml(description: string, p: Parsed): string {
  return compileHtml("{{signals_table_rows}}", {
    description,
    parsed: p,
    disagreement: null,
    generatedAt: new Date().toISOString(),
  });
}

export function downloadBlob(filename: string, mime: string, content: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
