import os
import httpx
from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, conlist
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# --- Secrets ---
MISTRAL_API_KEY = os.getenv("MISTRAL_API_KEY")
BACKEND_TOKEN = os.getenv("BACKEND_TOKEN")

if not MISTRAL_API_KEY:
    raise RuntimeError("MISTRAL_API_KEY manquant")
if not BACKEND_TOKEN:
    raise RuntimeError("BACKEND_TOKEN manquant")

MISTRAL_URL = "https://api.mistral.ai/v1/chat/completions"

app = FastAPI()

# --- Rate limit ---
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, lambda r, e: HTTPException(429, "Too many requests"))

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://www.siouxlog.fr"],
    allow_methods=["POST"],
    allow_headers=["Content-Type"],
)

# --- Models allowed ---
ALLOWED_MODELS = {"mistral-large-latest", "mistral-small-latest"}

# --- Validation ---
class Message(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=6000)

class ChatRequest(BaseModel):
    messages: conlist(Message, min_items=1, max_items=20)
    model: str = "mistral-large-latest"
    temperature: float = Field(ge=0, le=1)

# --- Auth ---
def check_auth(request: Request):
    token = request.headers.get("Authorization")
    if token != f"Bearer {BACKEND_TOKEN}":
        raise HTTPException(401, "Unauthorized")

SYSTEM_PROMPT = "Tu es Ziva, l'assistante officielle de SiouxLog."

# --- Endpoint ---
@app.post("/chat")
@limiter.limit("10/minute")
async def chat(req: ChatRequest, request: Request, _=Depends(check_auth)):

    if req.model not in ALLOWED_MODELS:
        raise HTTPException(400, "Model not allowed")

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        *[m.dict() for m in req.messages]
    ]

    headers = {
        "Authorization": f"Bearer {MISTRAL_API_KEY}",
        "Content-Type": "application/json"
    }

    payload = {
        "messages": messages,
        "model": req.model,
        "temperature": req.temperature,
        "max_tokens": 800
    }

    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.post(MISTRAL_URL, json=payload, headers=headers)

    if r.status_code != 200:
        raise HTTPException(502, "Mistral API error")

    data = r.json()
    return {"reply": data["choices"][0]["message"]["content"]}
