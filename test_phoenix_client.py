from phoenix.client import Client

client = Client(base_url="http://localhost:6006")

try:
    print("Prompts attribute:", hasattr(client, "prompts"))
    if hasattr(client, "prompts"):
        print("Methods:", [m for m in dir(client.prompts) if not m.startswith("_")])
        
        try:
            prompt_version = client.prompts.get(prompt_identifier="llm-judge-classification")
            import inspect
            print("Format signature:", inspect.signature(prompt_version.format))
            print("Format doc:", prompt_version.format.__doc__)
            
            # Let's also check if we can just grab the raw text
            if hasattr(prompt_version, "_template"):
                print("Template structure:", prompt_version._template)
        except Exception as e2:
            print("Failed to fetch/format:", e2)
except Exception as e:
    import traceback
    traceback.print_exc()
