import sys
import os
import argparse
from phoenix.client import Client

def main():
    parser = argparse.ArgumentParser(description="Fetch a prompt from Phoenix.")
    parser.add_argument("prompt_name", type=str, help="Name of the prompt to fetch")
    parser.add_argument("--tag", type=str, default=None, help="Tag of the prompt version")
    args = parser.parse_args()
    
    client = Client(base_url="http://localhost:6006")
    try:
        if args.tag:
            prompt_version = client.prompts.get(prompt_identifier=args.prompt_name, tag=args.tag)
        else:
            prompt_version = client.prompts.get(prompt_identifier=args.prompt_name)
        template = ""
        
        if hasattr(prompt_version, "template"):
            template = prompt_version.template
        elif hasattr(prompt_version, "_template") and isinstance(prompt_version._template, dict):
            # Extract Chat prompt messages
            messages = prompt_version._template.get("messages", [])
            for msg in messages:
                content = msg.get("content", [])
                if content and isinstance(content, list):
                    template += content[0].get("text", "") + "\n\n"
                else:
                    template += str(content) + "\n\n"
                    
        if not template:
            raise ValueError("Empty template extracted.")
            
        print(template.strip())
        
    except Exception as e:
        sys.stderr.write(f"{str(e)}\n")
        sys.exit(1)

if __name__ == "__main__":
    main()
