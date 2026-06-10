import { createFileRoute } from "@tanstack/react-router";
import fs from "node:fs";
import path from "node:path";
import { marked } from "marked";

export const Route = createFileRoute("/api/help")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const filePath = path.join(process.cwd(), "resources", "help.md");
          const markdownContent = fs.readFileSync(filePath, "utf-8");
          
          const parts = markdownContent.split("===TAB===");
          const overviewHtml = await marked.parse(parts[0] || "");
          const guideHtml = await marked.parse(parts[1] || "");
          
          const cssStyles = `
<style>
  .help-content { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; line-height: 1.6; color: #000; }
  .help-content h1 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.2em; font-weight: bold; margin-bottom: 16px; border-bottom: 1px solid black; padding-bottom: 8px; }
  .help-content h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.2em; font-weight: bold; margin-top: 24px; margin-bottom: 12px; color: #000; background: #f5f5f5; padding: 4px 8px; border-left: 3px solid black; }
  .help-content ul, .help-content ol { padding-left: 24px; margin-bottom: 16px; }
  .help-content li { margin-bottom: 8px; }
  .help-content li::marker { color: black; }
  .help-content strong { background-color: rgba(255, 255, 0, 0.4); padding: 0 4px; color: black; font-weight: bold; }
  .help-content p { margin-bottom: 16px; }
</style>
`;

          return new Response(
            JSON.stringify({
              overviewHtml: cssStyles + '<div class="help-content">' + overviewHtml + '</div>',
              guideHtml: cssStyles + '<div class="help-content">' + guideHtml + '</div>',
            }),
            {
              headers: { "Content-Type": "application/json" },
            }
          );
        } catch (e) {
          return new Response(JSON.stringify({ error: "Help documentation not found." }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
