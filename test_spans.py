from phoenix.client import Client
import pandas as pd

client = Client(base_url="http://localhost:6006")
try:
    df = client.spans.get_spans_dataframe(project_name="air-control")
    class_spans = df[df['name'] == 'Stage: CLASSIFICATION']
    if not class_spans.empty:
        print("Batch Attributes:", class_spans.iloc[0].get('attributes.batch'))
except Exception as e:
    print("Error:", e)
    print("Error:", e)
