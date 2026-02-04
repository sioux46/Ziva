import os
import requests
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

# --- Clé API Mistral ---
MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY")
if not MISTRAL_API_KEY:
    raise RuntimeError("MISTRAL_API_KEY n'est pas définie !")

MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions"

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://ziva.local:8888",
                    "https://www.siouxlog.fr"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "Authorization"],
)

class ChatRequest(BaseModel):
    messages: list
    model: str = "mistral-large-latest"
    temperature: float = 0.7

@app.post("/chat")
def chat(req: ChatRequest):
    # pdb.set_trace()  # <-- breakpoint ici
    headers = {
        "Authorization": f"Bearer {MISTRAL_API_KEY}",
        "Content-Type": "application/json"
    }

    payload = {
        "messages": req.messages,
        "model": req.model,
        "temperature": req.temperature,
        "max_tokens": 1000
    }

    r = requests.post(MISTRAL_URL, headers=headers, json=payload, timeout=30)

    if r.status_code != 200:
        return {"error": r.text}

    data = r.json()
    return {
        "reply": data["choices"][0]["message"]["content"]
    }
