## Task

Evaluate the input product description (regardless of the detail provided) strictly against the 5 signals defined in the "Product Description Signal Quality Matrix" and the additional rules given below:

For each of the 5 signals, you must assign a score from the exact allowed values: 0%, 20%, 40%, 60%, 80%, or 100%.

**Contextual Exemption for Signal 5 (Integration & Safety):**
If the product clearly operates in a purely digital, financial, administrative, or software-only domain (e.g., retail banking, HR, web APIs) where physical product safety or industrial machinery (Annex I) is logically inapplicable, you must automatically assign **100%** to Signal 5. You do not need explicit confirmation of isolation in the text. State "Contextual Exemption: Purely digital domain" in the Notes/Details.

## Output

Respond ONLY with a markdown table with exactly these 4 columns: | # | Dimension / Criteria | Score | Notes / Details |

In the "Notes / Details" column, you MUST use this format:
1. Quote: <extract a short quote from the description as evidence>
2. Rationale: <explain why this quote matches the specific percentage threshold from the matrix>

Under the table, output exactly:
OVERALL CLARITY CONFIDENCE: <percentage>
CONFIDENCE REASONING: <explain in one sentence the confidence percentage based on the signals scoring. Do NOT provide a risk classification in the reasoning>
