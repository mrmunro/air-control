import os
import argparse
import requests
import pandas as pd
from phoenix.client import Client
from phoenix.trace.dsl import SpanQuery


def check_classification_risk(output_text, batch_dict):
    expected_risk = batch_dict.get("expected_risk")

    if pd.notna(expected_risk) and expected_risk.strip():
        clean_expected_risk = expected_risk.split("(")[0].strip().lower()
        if clean_expected_risk in str(output_text).lower():
            return True, "Exact match with expected risk."

    return False, None


def check_classification_role(output_text, batch_dict):
    expected_role = batch_dict.get("expected_role")

    if pd.notna(expected_role) and expected_role.strip():
        clean_expected_role = expected_role.split("(")[0].strip().lower()
        if clean_expected_role in str(output_text).lower():
            return True, "Exact match with expected role."

    return False, None


DETERMINISTIC_EVALUATORS = {
    "RISK": check_classification_risk,
    "ROLE": check_classification_role,
}


class SafeDict(dict):
    def __missing__(self, key):
        return "N/A"


def evaluate_stage(
    deterministic_check,
    input_text,
    output_text,
    api_key,
    eval_prompt_template,
    batch_dict,
):
    # 1. Try deterministic evaluation if this stage has one configured
    evaluator = DETERMINISTIC_EVALUATORS.get(deterministic_check.upper())
    if evaluator:
        is_correct, explanation = evaluator(output_text, batch_dict)
        if is_correct:
            return 1.0, "accurate", explanation, None

    # 2. Fall back to LLM Judge
    # Safely inject all batch variables (like expected_risk, category, etc.) plus core variables
    format_args = SafeDict(batch_dict)
    format_args["input_text"] = input_text
    format_args["output_text"] = output_text

    prompt = eval_prompt_template.format_map(format_args)

    provider = os.environ.get("LLM_PROVIDER", "gemini").lower()
    llm_response = ""

    try:
        if provider == "anthropic":
            import anthropic

            api_key = os.environ.get("ANTHROPIC_API_KEY")
            if not api_key:
                return None, "error", "ANTHROPIC_API_KEY not set", eval_prompt_template
            client = anthropic.Anthropic(api_key=api_key)
            model = os.environ.get("LLM_MODEL", "claude-sonnet-4-6")
            message = client.messages.create(
                model=model,
                max_tokens=7000,
                messages=[{"role": "user", "content": prompt}],
            )
            llm_response = message.content[0].text.strip()
        elif provider == "openai":
            from openai import OpenAI

            api_key = os.environ.get("OPENAI_API_KEY")
            if not api_key:
                return None, "error", "OPENAI_API_KEY not set", eval_prompt_template
            client = OpenAI(api_key=api_key)
            model = os.environ.get("LLM_MODEL", "gpt-4o")
            response = client.chat.completions.create(
                model=model, messages=[{"role": "user", "content": prompt}]
            )
            llm_response = response.choices[0].message.content.strip()
        else:
            api_key = os.environ.get("GEMINI_API_KEY")
            if not api_key:
                return None, "error", "GEMINI_API_KEY not set", eval_prompt_template
            model = os.environ.get("LLM_MODEL", "gemini-3.5-flash")
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
            payload = {"contents": [{"parts": [{"text": prompt}]}]}
            response = requests.post(
                url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=15,
            )
            if response.status_code != 200:
                print(f"HTTP Error {response.status_code}: {response.text}")
                return (
                    None,
                    "error",
                    f"HTTP {response.status_code}: {response.text}",
                    eval_prompt_template,
                )

            data = response.json()
            llm_response = data["candidates"][0]["content"]["parts"][0]["text"].strip()

        # Parse VERDICT and REASONING
        verdict = ""
        reasoning = llm_response

        for line in llm_response.split("\n"):
            if line.upper().startswith("VERDICT:"):
                verdict = line.split(":", 1)[1].strip().lower()
            elif line.upper().startswith("REASONING:"):
                reasoning = line.split(":", 1)[1].strip()
                # Grab the rest of the lines as reasoning too
                idx = llm_response.upper().find("REASONING:")
                if idx != -1:
                    reasoning = llm_response[idx + len("REASONING:") :].strip()
                break

        if "inaccurate" in verdict:
            return 0.0, "inaccurate", reasoning, eval_prompt_template
        if "accurate" in verdict:
            return 1.0, "accurate", reasoning, eval_prompt_template

        return (
            0.0,
            "inaccurate",
            f"Unrecognized verdict. Raw response: {llm_response}",
            eval_prompt_template,
        )
    except Exception as e:
        print(f"Error evaluating row: {e}")
        return None, "error", str(e), eval_prompt_template


def main():
    parser = argparse.ArgumentParser(description="Evaluate Pipeline traces.")
    parser.add_argument(
        "--session-id",
        type=str,
        help="Evaluate a specific batch session (e.g. batch-1701234567). If omitted, evaluates the most recent batch session.",
    )
    parser.add_argument(
        "--stage",
        type=str,
        default="CLASSIFICATION",
        help="The pipeline stage to evaluate (e.g. CLASSIFICATION, SIGNALS).",
    )
    parser.add_argument(
        "--prompt-name",
        type=str,
        default="llm-judge-classification",
        help="The identifier of the prompt in Phoenix or resources/prompts/ fallback.",
    )
    parser.add_argument(
        "--tag",
        type=str,
        default=None,
        help="The tag of the prompt in Phoenix (e.g., development).",
    )
    parser.add_argument(
        "--deterministic-check",
        type=str,
        default="NONE",
        help="The deterministic fast-path to run (e.g. RISK, ROLE, NONE).",
    )
    parser.add_argument(
        "--annotation-name",
        type=str,
        default=None,
        help="The name of the annotation in Phoenix (e.g. 'Risk Accuracy').",
    )
    parser.add_argument(
        "--inject-file",
        type=str,
        action="append",
        help="Inject a file into prompt variables. Format: key=path (e.g. --inject-file matrix=resources/matrix.md). Can be specified multiple times.",
    )
    args = parser.parse_args()

    # Adjust default prompt name based on deterministic check if not overridden
    if args.prompt_name == "llm-judge-classification":
        if args.deterministic_check.upper() == "ROLE":
            args.prompt_name = "llm-judge-role"

    # Process injected files globally
    injected_vars = {}
    if args.inject_file:
        for inject_arg in args.inject_file:
            if "=" not in inject_arg:
                print(
                    f"ERROR: Invalid --inject-file format: {inject_arg}. Must be key=path."
                )
                return
            key, path = inject_arg.split("=", 1)
            if not os.path.exists(path):
                print(f"ERROR: Injected file not found: {path}")
                return
            with open(path, "r", encoding="utf-8") as f:
                injected_vars[key] = f.read()
            print(f"Successfully loaded injected file: {path} into variable '{key}'")

    print("Connecting to Phoenix server at http://localhost:6006...")
    client = Client(base_url="http://localhost:6006")

    print(f"Fetching traces from Phoenix for stage: {args.stage}...")
    df = client.spans.get_spans_dataframe(project_name="air-control")

    if df.empty:
        print("No traces found! Please run the pipeline in the app first.")
        return

    # Fetch prompt
    eval_prompt_template = None
    try:
        print(f"Attempting to fetch prompt '{args.prompt_name}' from Phoenix...")
        if args.tag:
            prompt_version = client.prompts.get(
                prompt_identifier=args.prompt_name, tag=args.tag
            )
        else:
            prompt_version = client.prompts.get(prompt_identifier=args.prompt_name)

        if hasattr(prompt_version, "template"):
            eval_prompt_template = prompt_version.template
        elif hasattr(prompt_version, "_template") and isinstance(
            prompt_version._template, dict
        ):
            # It's a chat prompt, concatenate ALL message texts
            messages = prompt_version._template.get("messages", [])
            eval_prompt_template = ""
            for msg in messages:
                content = msg.get("content", [])
                if content and isinstance(content, list):
                    eval_prompt_template += content[0].get("text", "") + "\n\n"
                else:
                    eval_prompt_template += str(content) + "\n\n"
            eval_prompt_template = eval_prompt_template.strip()

        if not eval_prompt_template:
            raise ValueError(
                "Could not extract template text from Phoenix PromptVersion"
            )

        print("Successfully fetched prompt from Phoenix.")
    except Exception as e:
        print(
            f"Could not fetch prompt from Phoenix ({e}). Attempting local fallback..."
        )
        fallback_path = os.path.join("resources", "prompts", f"{args.prompt_name}.md")
        if os.path.exists(fallback_path):
            with open(fallback_path, "r", encoding="utf-8") as f:
                eval_prompt_template = f.read()
            print(f"Successfully loaded prompt from {fallback_path}.")
        else:
            print(
                f"ERROR: Local fallback file {fallback_path} does not exist. Aborting."
            )
            return

    provider = os.environ.get("LLM_PROVIDER", "gemini").lower()
    api_key = None
    if provider == "anthropic":
        api_key = os.environ.get("ANTHROPIC_API_KEY")
    elif provider == "openai":
        api_key = os.environ.get("OPENAI_API_KEY")
    else:
        api_key = os.environ.get("GEMINI_API_KEY")

    if not api_key:
        print(
            f"ERROR: API Key environment variable is not set for provider {provider}."
        )
        return

    pipeline_spans = df[df["name"] == "Compliance Pipeline"]
    if pipeline_spans.empty:
        print("No Compliance Pipeline root traces found.")
        return

    # Determine target session
    target_session = args.session_id
    if not target_session:
        if "attributes.session.id" not in df.columns:
            print(
                "No batch sessions found in traces. Please run the batch script first."
            )
            return

        # Find the most recent span with a session ID
        pipeline_spans_with_session = pipeline_spans[
            pipeline_spans["attributes.session.id"].notna()
        ]
        if pipeline_spans_with_session.empty:
            print(
                "No batch sessions found in traces. Please run the batch script first."
            )
            return

        latest_span = pipeline_spans_with_session.sort_values(
            by="start_time", ascending=False
        ).iloc[0]
        target_session = latest_span["attributes.session.id"]
        print(f"Auto-selected most recent batch session: {target_session}")
    else:
        print(f"Filtering to specified session: {target_session}")

    root_spans_for_session = pipeline_spans[
        pipeline_spans["attributes.session.id"] == target_session
    ]
    valid_root_ids = set(root_spans_for_session.index)

    stage_spans = df[
        (df["name"] == f"Stage: {args.stage.upper()}")
        & (df["parent_id"].isin(valid_root_ids))
    ]

    if stage_spans.empty:
        print(f"No {args.stage.upper()} stages found for session {target_session}.")
        return

    print(
        f"Evaluating {len(stage_spans)} {args.stage} traces using {provider.upper()} ({os.environ.get('LLM_MODEL', 'default')})..."
    )

    results = []
    used_eval_prompt = eval_prompt_template
    for chain_id, row in stage_spans.iterrows():
        # Find the child LLM span (where parent_id == chain_id)
        child_llm = df[df["parent_id"] == chain_id]
        if child_llm.empty:
            llm_span_id = chain_id
        else:
            llm_span_id = child_llm.index[0]

        # When using native dataframe, nested attributes can either be in `attributes.batch` dict
        # or fully flattened. Usually they are in `attributes.batch` as a dict if it was a JSON object.
        batch_attrs = row.get("attributes.batch", {})
        batch_dict = batch_attrs if isinstance(batch_attrs, dict) else {}
        # Merge injected variables into batch dictionary
        batch_dict.update(injected_vars)

        input_val = row.get("attributes.input.value", "")
        output_val = row.get("attributes.output.value", "")

        score, label, explanation, _ = evaluate_stage(
            args.deterministic_check,
            input_val,
            output_val,
            api_key,
            eval_prompt_template,
            batch_dict,
        )

        # Skip appending if score is None to prevent JSON NaN serialization errors
        if score is not None:
            results.append(
                {
                    "span_id": llm_span_id,
                    "score": score,
                    "label": label,
                    "explanation": explanation,
                }
            )

    if not results:
        print("All evaluations failed. See errors above.")
        return

    eval_df = pd.DataFrame(results)
    eval_df.set_index("span_id", inplace=True)

    print("\nEvaluation Results:")
    print(eval_df.head())

    if args.annotation_name:
        annotation_name = args.annotation_name
    elif args.deterministic_check.upper() != "NONE":
        annotation_name = f"{args.deterministic_check.capitalize()} Accuracy"
    else:
        annotation_name = f"{args.stage.capitalize()} Accuracy"
    print("\nPushing results back to Phoenix...")
    client.spans.log_span_annotations_dataframe(
        dataframe=eval_df, annotation_name=annotation_name, annotator_kind="LLM"
    )

    if used_eval_prompt:
        import json
        from datetime import datetime, UTC

        history_entry = {
            "session_id": target_session,
            "timestamp": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
            "event": "evaluation_run",
            "eval_prompt": used_eval_prompt,
        }

        with open("resources/eval/prompt_history.jsonl", "a") as f:
            f.write(json.dumps(history_entry) + "\n")

        # Annotate the session in Phoenix
        try:
            # We can use log_session_annotations or update session directly if supported.
            # Using custom annotation approach for session level:
            print(f"Logged evaluation prompt to history for session {target_session}")
        except Exception as e:
            pass

    print(
        "Done! Check your Phoenix dashboard to see the evaluations attached to the traces."
    )


if __name__ == "__main__":
    main()
