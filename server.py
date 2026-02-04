import os
import httpx
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, conlist
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# --- Clé API Mistral ---
MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY")
if not MISTRAL_API_KEY:
    raise RuntimeError("MISTRAL_API_KEY n'est pas définie !")

MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions"

app = FastAPI()

# --- CORS strict ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://ziva.local:8888",
                    "https://www.siouxlog.fr"],
    allow_methods=["POST"],
    allow_headers=["Content-Type", "Authorization"],
)

# --- Modèles autorisés ---
ALLOWED_MODELS = {"mistral-large-latest", "mistral-small-latest"}

# --- Validation ---
class Message(BaseModel):
    role: str = Field(pattern="^(user|assistant|system)$")
    content: str = Field(min_length=1, max_length=6000)

class ChatRequest(BaseModel):
    messages: conlist(Message, min_items=1, max_items=30)
    model: str = "mistral-large-latest"
    temperature: float = 0.7

# --- Auth frontend ---
def check_auth(request: Request):
    token = request.headers.get("Authorization")
    if token != f"Bearer {BACKEND_TOKEN}":
        raise HTTPException(401, "Unauthorized")

# --- Endpoint ---
@app.post("/chat")
@limiter.limit("10/minute")
async def chat(req: ChatRequest):

    if req.model not in ALLOWED_MODELS:
        raise HTTPException(400, "Model not allowed")

    headers = {
        "Authorization": f"Bearer {BACKEND_TOKEN}",
        "Authorization": f"Bearer {MISTRAL_API_KEY}",
        "Content-Type": "application/json"
    }

    payload = {
        "messages": [m.dict() for m in req.messages],
        "model": req.model,
        "temperature": req.temperature,
        "max_tokens": 1000
    }

    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(MISTRAL_URL, json=payload, headers=headers)


    if r.status_code != 200:
        raise HTTPException(502, "Mistral API error")

    data = r.json()

    return {
        "reply": data["choices"][0]["message"]["content"]
    }
