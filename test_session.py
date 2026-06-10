from phoenix.client import Client
from phoenix.trace.dsl import SpanQuery

client = Client(base_url="http://localhost:6006")
try:
    df = client.spans.get_spans_dataframe(project_name="air-control")
    llm_spans = df[df['attributes.openinference.span.kind'] == 'LLM']
    if not llm_spans.empty:
        print("Model Names:", llm_spans['attributes.llm.model_name'].unique() if 'attributes.llm.model_name' in df.columns else "No model_name column")
        print("Prompt Tokens:", llm_spans['attributes.llm.token_count.prompt'].unique() if 'attributes.llm.token_count.prompt' in df.columns else "No prompt tokens column")
        print("Completion Tokens:", llm_spans['attributes.llm.token_count.completion'].unique() if 'attributes.llm.token_count.completion' in df.columns else "No completion tokens column")
    else:
        print("No LLM spans found.")
except Exception as e:
    import traceback
    traceback.print_exc()
