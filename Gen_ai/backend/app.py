from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import os
import uvicorn
import numpy as np
from dotenv import load_dotenv
from ai_engine import HybridInterviewEngine

load_dotenv()

app = FastAPI(title="AI Mock Interview Engine API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = HybridInterviewEngine(use_bert=True, use_llm=None)


def _warm_up_llm():
    if not engine.llm:
        return
    if os.environ.get("LLM_WARMUP", "true").lower() not in ("1", "true", "yes"):
        return
    import threading
    threading.Thread(target=engine.llm.warm_up, daemon=True).start()


@app.on_event("startup")
def _on_startup():
    _warm_up_llm()

class InterviewRequest(BaseModel):
    role: str
    topic: str
    difficulty: str
    history: List[str] = []

class AnswerRequest(BaseModel):
    user_id: str = "default_user"
    question: str
    user_answer: str
    ideal_answer: str
    current_difficulty: str
    topic: str = ""
    role: str = ""
    session_id: str = ""


class EndSessionRequest(BaseModel):
    session_id: str

@app.post("/api/generate_question")
def generate_question(req: InterviewRequest):
    question, ideal_answer = engine.generate_question(req.role, req.topic, req.difficulty, req.history)
    return {"question": question, "ideal_answer": ideal_answer}

@app.post("/api/evaluate_answer")
def evaluate_answer(req: AnswerRequest):
    result = engine.evaluate_answer_hybrid(
        req.user_id,
        req.question,
        req.user_answer,
        req.ideal_answer,
        req.current_difficulty,
        topic=req.topic,
        role=req.role,
        session_id=req.session_id,
    )
    return {
        "evaluation": result,
        "next_difficulty": result.get("difficulty_level"),
        "user_id": req.user_id,
        "session_id": req.session_id,
    }


@app.get("/api/sessions")
def list_sessions(user_id: str = None, limit: int = 50):
    sessions = engine.list_sessions(user_id=user_id, limit=limit)
    return {"sessions": sessions}


@app.get("/api/sessions/{session_id}")
def get_session(session_id: str):
    session = engine.get_session(session_id)
    if session is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.post("/api/end_session")
def end_session(req: EndSessionRequest):
    engine.end_session(req.session_id)
    return {"session_id": req.session_id, "ended": True}

@app.get("/api/get_analytics")
def get_analytics():
    return engine.get_analytics()

@app.get("/api/analytics/detailed")
def get_detailed_analytics():
    """Research-grade analytics endpoint with model comparison and performance metrics."""
    analytics = engine.get_analytics()
    
    # Add model comparison analysis
    if analytics.get("model_comparisons"):
        model_comparisons = analytics["model_comparisons"]
        model_names = ["tfidf", "bert", "llm", "hybrid"]
        
        comparison = {}
        for model_name in model_names:
            scores = model_comparisons.get(model_name, [])
            if scores:
                comparison[model_name] = {
                    "mean": round(sum(scores) / len(scores), 3),
                    "min": round(min(scores), 3),
                    "max": round(max(scores), 3),
                    "std_dev": round(np.std(scores), 3) if len(scores) > 1 else 0,
                    "count": len(scores)
                }
        
        analytics["model_comparison_stats"] = comparison
    
    return analytics

from fastapi.staticfiles import StaticFiles
import os

frontend_path = os.path.join(os.path.dirname(__file__), "..", "frontend")
app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")

if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_includes=["*.py", "*.env"],
    )
