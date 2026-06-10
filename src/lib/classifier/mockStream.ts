// Mock streamed classification payload. The engine emits stage-delimited
// blocks that the parser converts into structured state. Designed for an
// AI resume-screening tool to align with EU AI Act Annex III.

export const MOCK_STREAM = `[STAGE: SIGNALS]
| Signal | Rating | Note |
| --- | --- | --- |
| Intended Purpose | HIGH | Automated ranking of job applicants for HR decisions. |
| Deployment Context | HIGH | Employment / workforce management (Annex III §4). |
| Data & Logic | MED | Historical hiring data; potential proxy bias not disclosed. |
| Human Oversight | LOW | No human-in-the-loop described before shortlisting. |
| Safety Component | LOW | Not a safety component of a regulated product. |

[STAGE: CLASSIFICATION]
PRIMARY_RISK: High Risk
PRIMARY_ROLE: Deployer
RATIONALE: The system performs automated evaluation and ranking of natural persons for employment decisions, which falls under Annex III §4 of the EU AI Act. As the organisation operating the system on its own authority, the user qualifies as a Deployer with obligations under Article 26.

[STAGE: MAP]
- SNIPPET: "ranks applicants using historical hiring data"
  REF: Article 6(2)
  URL: https://artificialintelligenceact.eu/article/6/
  REASONING: AI systems listed in Annex III are deemed high-risk under Article 6(2). Ranking applicants is explicitly covered by Annex III §4(a).
- SNIPPET: "automated screening of CVs for HR teams"
  REF: Annex III §4
  URL: https://artificialintelligenceact.eu/annex/3/
  REASONING: Annex III §4 covers AI used in employment, worker management and access to self-employment — including recruitment and selection.
- SNIPPET: "historical hiring data"
  REF: Article 10
  URL: https://artificialintelligenceact.eu/article/10/
  REASONING: Training data governance obligations apply: datasets must be examined for biases that could affect health, safety, or fundamental rights.
- SNIPPET: "ranks applicants"
  REF: Article 14
  URL: https://artificialintelligenceact.eu/article/14/
  REASONING: High-risk systems must be designed for effective human oversight during the period in which they are in use.

[STAGE: WARNINGS]
- TITLE: Proxy discrimination via historical data
  DETAIL: Training on past hiring decisions can encode demographic bias. Without mitigation, the system may produce unlawful indirect discrimination under EU non-discrimination law.
- TITLE: Insufficient human oversight
  DETAIL: Ranking without a meaningful human review step risks breaching Article 14. Reviewers need authority and time to override the system.
- TITLE: Transparency to candidates
  DETAIL: Article 26(11) requires informing affected natural persons that they are subject to a high-risk AI decision. Candidate-facing disclosure is required.

[STAGE: INFO]
- TITLE: Conformity assessment
  DETAIL: A conformity assessment per Article 43 is required before placing the system on the EU market or putting it into service.
- TITLE: EU database registration
  DETAIL: Register the high-risk system in the EU database (Article 49) prior to deployment.
- TITLE: Post-market monitoring
  DETAIL: Establish a post-market monitoring plan (Article 72) to track performance, incidents and drift across the lifecycle.
- TITLE: Logging
  DETAIL: Automatically log events over the system lifetime (Article 12) to enable traceability of outputs.
`;

export const STAGE_ORDER = [
  "SIGNALS",
  "CLASSIFICATION",
  "MAP",
  "WARNINGS",
  "INFO",
  "REPORTS",
] as const;

export type StageName = (typeof STAGE_ORDER)[number];
