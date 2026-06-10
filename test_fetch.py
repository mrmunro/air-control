import logging
logging.basicConfig(level=logging.DEBUG)
from phoenix.client import Client
client = Client(base_url="http://localhost:6006")
try:
    client.prompts.get("eu-ai-act-classifier-system-prompt")
except Exception as e:
    pass
