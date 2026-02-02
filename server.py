import os
import requests
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY")

MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions"

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # change en prod
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    messages: list
    model: str = "mistral-medium-latest"
    temperature: float = 0.7

@app.post("/chat")
def chat(req: ChatRequest):
    headers = {
        "Authorization": f"Bearer {MISTRAL_API_KEY}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": req.model,
        "messages": req.messages,
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
