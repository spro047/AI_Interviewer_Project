import os
import json
import re
from pathlib import Path

try:
    from huggingface_hub import InferenceClient
    HAS_HF_HUB = True
except ImportError:
    HAS_HF_HUB = False


DEFAULT_MODEL = "Qwen/Qwen2.5-7B-Instruct"
DEFAULT_TIMEOUT = 30

SYSTEM_PROMPT_PATH = Path(__file__).parent / "system_prompt.txt"


def _load_system_prompt() -> str:
    try:
        return SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")
    except FileNotFoundError:
        return "You are a specialized AI Interview Engine."


def _strip_code_fence(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
    return text.strip()


def _extract_json(text: str) -> dict:
    text = _strip_code_fence(text)
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if not match:
            raise
        return json.loads(match.group(0))


class LLMUnavailable(RuntimeError):
    pass


class LLMClient:
    def __init__(self, model: str | None = None, token: str | None = None, timeout: int = DEFAULT_TIMEOUT):
        if not HAS_HF_HUB:
            raise LLMUnavailable("huggingface-hub is not installed; run `pip install huggingface-hub`.")

        token = token or os.environ.get("HF_TOKEN")
        if not token or token.startswith("PASTE_") or token == "hf_your_huggingface_token_here":
            raise LLMUnavailable("HF_TOKEN is not set. Add a real token to backend/.env.")

        self.model = model or os.environ.get("LLM_MODEL", DEFAULT_MODEL)
        self.system_prompt = _load_system_prompt()
        self.client = InferenceClient(model=self.model, token=token, timeout=timeout)

    def _chat(self, user_message: str, system: str | None = None, max_tokens: int = 512) -> str:
        messages = []
        messages.append({"role": "system", "content": system or self.system_prompt})
        messages.append({"role": "user", "content": user_message})
        resp = self.client.chat_completion(
            messages=messages,
            max_tokens=max_tokens,
            temperature=0.7,
        )
        return resp.choices[0].message.content

    def warm_up(self) -> None:
        try:
            self._chat("Reply with the single word: ok", max_tokens=8)
        except Exception:
            pass

    def generate_question(self, role: str, topic: str, difficulty: str, history: list | None = None) -> tuple[str, str]:
        history = history or []
        recent = history[-5:]
        if recent:
            recent_text = "\n".join(f"- {q}" for q in recent if q)
        else:
            recent_text = "(none yet)"

        user_msg = (
            "Generate ONE technical interview question for the candidate.\n\n"
            f"Role: {role}\n"
            f"Topic: {topic}\n"
            f"Difficulty: {difficulty}\n\n"
            f"Previously asked questions (do NOT repeat or trivially rephrase any of these):\n{recent_text}\n\n"
            "Respond with strict JSON only — no markdown, no commentary, no code fences:\n"
            '{"question": "<the question>", "ideal_answer": "<a concise ideal answer (2-4 sentences)>"}'
        )

        text = self._chat(user_msg, max_tokens=400)
        data = _extract_json(text)

        question = str(data.get("question", "")).strip()
        ideal = str(data.get("ideal_answer", "")).strip()
        if not question:
            raise LLMUnavailable("LLM returned an empty question.")
        return question, ideal

    def evaluate_explanation(self, question: str, user_answer: str, ideal_answer: str, base_metrics: dict) -> dict:
        tfidf = float(base_metrics.get("tfidf", 0.0) or 0.0)
        semantic = float(base_metrics.get("semantic", 0.0) or 0.0)

        user_msg = (
            "You are evaluating a candidate's interview answer.\n\n"
            f"Question: {question}\n"
            f"Ideal answer (for reference): {ideal_answer}\n"
            f"Candidate's answer: {user_answer}\n\n"
            f"Base metrics (0-1 scale, computed independently):\n"
            f"- TF-IDF overlap: {tfidf:.2f}\n"
            f"- Semantic similarity: {semantic:.2f}\n\n"
            "Provide a structured evaluation. Respond with strict JSON only — no markdown, no commentary, no code fences:\n"
            '{"llm_score": <0..1>, "concept_coverage": <0..1>, "depth": <0..1>, "clarity": <0..1>, '
            '"missing_concepts": ["...", "..."], "improvement_suggestions": ["...", "..."]}'
        )

        text = self._chat(user_msg, max_tokens=600)
        data = _extract_json(text)

        def _clip01(v):
            try:
                return max(0.0, min(1.0, float(v)))
            except (TypeError, ValueError):
                return 0.0

        missing = data.get("missing_concepts") or []
        improvements = data.get("improvement_suggestions") or []
        if not isinstance(missing, list):
            missing = [str(missing)]
        if not isinstance(improvements, list):
            improvements = [str(improvements)]

        return {
            "llm_score": _clip01(data.get("llm_score", 0.0)),
            "concept_coverage": _clip01(data.get("concept_coverage", 0.0)),
            "depth": _clip01(data.get("depth", 0.0)),
            "clarity": _clip01(data.get("clarity", 0.0)),
            "missing_concepts": [str(m) for m in missing],
            "improvement_suggestions": [str(s) for s in improvements],
        }
