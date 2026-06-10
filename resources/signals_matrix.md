# Product Description Signal Quality Matrix

Evaluate each signal strictly using the 0%, 20%, 40%, 60%, 80%, or 100% buckets. 

## Signal 1. Intended Purpose & Sector Domain (Article 6 & Annex III)
Evaluate whether the description clearly defines where and why the system is being deployed. Without this, it is impossible to determine if the system crosses into an Annex III High-Risk category (e.g., employment, critical infrastructure) or Article 5 Prohibited domains.
- **100%**: Conclusive Regulatory Alignment. The text provides an exhaustive, unambiguous definition of the intended purpose, explicitly mapping out the sector context, end-user profile, and hard technical constraints preventing the system from drifting into prohibited or high-risk use cases.
- **80%**: Explicit Functional Boundaries. Clearly defines what the tool is used for and includes hard exclusions regarding high-risk sectors (e.g., "Not for use in credit-scoring or HR hiring pipelines").
- **60%**: Specific Application Context. Clearly states the business problem it solves, allowing you to run an Annex III check, but fails to define boundary exclusions.
- **40%**: High-Level Domain Mentioned. Mentions an industry but leaves the exact application ambiguous.
- **20%**: Generic Action. Mentions what the tool does conceptually, but leaves the operational industry or domain entirely open.
- **0%**: Complete Absence. Vague, purely technical description with zero functional context.

## Signal 2. Supply Chain Origin & Value Chain Positioning (Article 3 & Article 25)
Identify the entity's exact operational role (Provider, Deployer, Importer, or Distributor) and details whether they are building a native application from scratch or modifying an underlying third-party foundational model (GPAI).
- **100%**: Complete Value Chain Map. Unequivocally defines the regulatory roles. It states who holds the trademark, the origin of the base model, any white-labeling agreements, and whether the system is deployed internally or sold to third parties.
- **80%**: Value Chain Roles Clear. Maps out exactly who hosts the system, where data flows, and who owns the commercial trademark (essential for spotting an Article 25 "Provider" shift).
- **60%**: Technical Provenance Defined. Explicitly states the relationship with third parties (e.g., "We are building a proprietary application layer that calls OpenAI’s GPT-4o API.").
- **40%**: Basic Deployment Structure. Identifies the user as a professional entity (indicating a "Deployer" status) but leaves the tech stack unmapped.
- **20%**: Single Entity Named. States who is using the tool but completely omits how the software is delivered or built.
- **0%**: Anonymous Architecture. The text describes features but masks who owns, hosts, or provides the technology.

## Signal 3. Human-in-the-Loop & Decision Autonomy (Article 6(3) Derogation)
Assess the tool's level of autonomy. If a system automatically makes decisions without a human checkpoint, it cannot claim a "narrow preparatory task" exemption under Article 6(3) if it sits near an Annex III domain.
- **100%**: Documented Governance Layer. Explicitly details the downstream workflow, demonstrating that the AI has zero decision-making authority, cannot automate actions, and serves purely as a structural input to a human decision-maker with a clear log of human overrides.
- **80%**: Purely Preparatory Structure. Details how the tool acts strictly as a workflow accelerator (e.g., "The AI drafts a risk summary, which is then passed to a qualified legal officer who conducts the actual, binding assessment.").
- **60%**: Explicit Human Review Mentioned. Confirms that a human reads the output before any final action is taken.
- **40%**: Advisory Clues. Uses words like "helps," "assists," or "recommends," implying a human is present, but lacks procedural definition.
- **20%**: Output Described, Workflow Ignored. Mentions that the system "outputs a report" or "flags risks," but doesn't explain what happens to that output.
- **0%**: Dark Box. The description implies magic execution; it is entirely unclear if a human ever reviews the output.

## Signal 4. System Modality & Interaction Interface (Article 50 Transparency)
Check for features that trigger Article 50 transparency laws. Evaluate whether the system interacts directly with humans, generates synthetic media (deepfakes), or analyzes human biometrics/emotions.
- **100%**: Total Interface & Modality Disclosure. Completely exposes the interaction layer. It specifies exactly who interacts with the AI, confirms the absence of biometric/emotion tracking, and details how the generative text outputs are presented and marked to comply with Article 50 transparency.
- **80%**: Core Transparency Vectors Addressed. Specifies exactly how users interact with the system and addresses whether emotion recognition or biometric profiling is technically present.
- **60%**: Generative Outputs Categorized. Clearly states whether the model modifies, creates, or watermarks synthetic content (text, images, audio).
- **40%**: Direct User Profile Defined. Identifies who is typing into the system, allowing you to check if "natural persons" are directly exposed to the LLM.
- **20%**: Basic Interface Type. Mentions the UI style (e.g., "It has a chat interface") but omits user interaction mechanics.
- **0%**: Blind Backend. No indication of how the system interacts with the world (API? Chatbot? Batch processor?).

## Signal 5. Integration Context & Product Safety Dependency (Article 6(1) & Annex I)
Check if the AI is a standalone tool or an embedded "safety component" of an industrial product already regulated under EU harmonization laws (like medical software, machinery, or aviation systems).
- **100%**: Definitive Architectural Isolation. Confirms the system's exact position within the enterprise architecture, proving it operates as isolated, non-safety-critical application software with no functional dependencies or integrations that could influence an Annex I regulated physical product.
- **80%**: Annex I Compatibility Confirmed. Explicitly states whether the software interfaces with products governed by EU harmonization directives (e.g., confirming it is not connected to medical diagnostic systems or physical machinery controls).
- **60%**: Integration Touchpoints Specified. Clarifies if the system passes data to safety-critical or heavily regulated enterprise pipelines.
- **40%**: Software Context Identified. States whether the software connects to other internal tools via APIs or webhooks.
- **20%**: High-Level Environment Named. Mentions where the software is installed (e.g., "installed on enterprise servers") but skips architectural dependencies.
- **0%**: Isolated Feature. The description looks at a standalone feature in a vacuum, with no reference to the broader infrastructure environment.