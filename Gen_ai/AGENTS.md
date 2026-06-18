# AGENTS.md

AI-powered adaptive mock interview. Decoupled: FastAPI backend (`backend/`) + vanilla HTML/CSS/JS frontend (`frontend/`). No monorepo tooling, no tests, no CI, no lint config — keep changes self-contained.

## Layout & real entrypoints

- `backend/app.py` — FastAPI app. Defines the four API routes, **mounts `../frontend` at `/`**, and loads `.env` via `python-dotenv` at import time. Fires a background LLM warm-up on startup if enabled.
- `backend/ai_engine.py` — `HybridInterviewEngine` (the "core novelty"). Wires scoring + adaptive + logger + (optional) LLM.
- `backend/scoring.py` — `ScoringEngine` (TF-IDF + BERT + heuristic-LLM scoring). Eagerly loads `all-MiniLM-L6-v2` on construction if `use_bert=True`; slow first start.
- `backend/llm.py` — `LLMClient` wrapper around `huggingface_hub.InferenceClient`. Reads `system_prompt.txt` as the system message. Exposes `generate_question()` and `evaluate_explanation()`. Raises `LLMUnavailable` on missing token / parse failure so the engine can fall back.
- `backend/adaptive.py` — Difficulty controller (easy → medium → hard thresholds in `update_and_get_difficulty`).
- `backend/logger.py` — Writes both `interview_logs.csv` and `interview_logs.db` in CWD on first evaluation. Maintains a `sessions` table (one row per interview session) and migrates the legacy `logs` table on first run to add `session_id`, `user_id`, `created_at` columns. Exposes `ensure_session` / `end_session` / `list_sessions` / `get_session` for the past-interview sidebar.
- `backend/system_prompt.txt` — **Now actually used** as the system message by `LLMClient`. Edit it to steer the model's interview style.
- `backend/.env` — Your real `HF_TOKEN` and feature flags. **Gitignored, never committed.**
- `backend/.env.example` — Template with placeholder values; safe to commit.
- `frontend/index.html`, `frontend/app.js`, `frontend/style.css` — Static assets, served by FastAPI's `StaticFiles` mount.
- `backend/__pycache__/` — gitignored build artifact, present in working tree; ignore.

## Run it

```bash
cd backend
pip install -r requirements.txt
# First time only: copy .env.example to .env and set HF_TOKEN
copy .env.example .env   # then edit backend/.env to paste your HF token
python app.py
# Open http://localhost:8000/
```

`uvicorn` runs with `reload=True`, so backend edits auto-restart. Frontend changes need a hard reload only.

## LLM integration (Hugging Face)

Optional. When enabled, the LLM replaces two heuristic paths:

- **Question generation** in `HybridInterviewEngine.generate_question` — `LLMClient.generate_question` is tried first; on any exception/timeout/parse-failure, falls back to the 30-template `QUESTION_BANK` in `ai_engine.py`.
- **Evaluation explanation** in `HybridInterviewEngine.evaluate_answer_hybrid` — `LLMClient.evaluate_explanation` provides the `llm_score`, `concept_coverage`, `depth`, `clarity`, `missing_concepts`, `improvement_suggestions`. Falls back to the heuristic in `scoring.py::compute_llm_quality` on failure.

Default model: `Qwen/Qwen2.5-7B-Instruct` (HF Inference API, free tier, Apache 2.0, chat-completions endpoint). Override with `LLM_MODEL` env var. Other chat-compatible models that work: `meta-llama/Meta-Llama-3-8B-Instruct`, `mistralai/Mistral-7B-Instruct-v0.2` (v0.3 is *not* marked as chat on the router), `HuggingFaceH4/zephyr-7b-beta`, `microsoft/Phi-3-mini-4k-instruct`.

### `.env` keys

| Var | Default | Purpose |
|---|---|---|
| `HF_TOKEN` | _(none)_ | Required when `USE_LLM=true`. Get from https://huggingface.co/settings/tokens |
| `USE_LLM` | `false` | Master switch. When `true`, the engine instantiates `LLMClient` and prefers LLM output. |
| `LLM_MODEL` | `Qwen/Qwen2.5-7B-Instruct` | Any chat-compatible model on HF Inference. |
| `LLM_WARMUP` | `true` | Sends a 1-token "ok" request in a daemon thread at startup so the first real user call isn't a 20–60s cold start. |

### Operational gotchas

- **Cold start**: first call to a model on HF Inference can take 20–60s. `LLM_WARMUP=true` mitigates this; first user call after server start still pays the cost if the warm-up request lands on a freshly-recycled worker.
- **Free-tier rate limits**: ~a few requests/min for some models. A normal interview (10–15 questions) is fine. Stress testing will hit limits.
- **No streaming**: the engine waits for the full response. Latency is end-to-end (typically 2–8s after warm-up). Frontend shows a "AI is evaluating..." placeholder during the wait.
- **Output contract**: `LLMClient` prompts the model for strict JSON and strips code fences; if JSON parsing still fails, the engine logs `[ai_engine] LLM ... failed` and falls back.
- **`system_prompt.txt`** is the LLM's system message. Edit it to change interviewer persona or output schema; the engine does not need code changes.
- If `HF_TOKEN` is missing or still the placeholder, `LLMClient.__init__` raises `LLMUnavailable` and the engine falls back silently.

## API contract (frontend depends on this exact shape)

All POSTs take/return JSON, hit `/api/*`.

- `POST /api/generate_question` — body `{role, topic, difficulty, history: [str]}`. Returns `{question, ideal_answer}`. **LLM-driven when `USE_LLM=true`**, otherwise from the template bank.
- `POST /api/evaluate_answer` — body `{user_id, question, user_answer, ideal_answer, current_difficulty, topic, role?, session_id?}`. Returns `{evaluation, next_difficulty, user_id, session_id}`. The `evaluation.explanation` block is LLM-driven when enabled. When `session_id` is supplied, the engine calls `logger.ensure_session(...)` on first call and persists `session_id` + `user_id` on every log row.
- `POST /api/end_session` — body `{session_id}`. Aggregates per-session stats (`num_questions`, `avg_score`, `max_score`, `min_score`) and stamps `ended_at`. Returns `{session_id, ended: true}`.
- `GET /api/sessions?user_id=&limit=50` — Returns `{sessions: [{session_id, user_id, role, topic, initial_difficulty, started_at, ended_at, num_questions, avg_score, max_score, min_score}, ...]}` ordered by most recent first. `user_id` and `limit` are optional.
- `GET /api/sessions/{session_id}` — Returns the same summary plus a `questions: [{id, question, user_answer, scores: {tfidf, bert, llm, final}, difficulty_level, confidence_score, created_at}, ...]` array. 404 if the session is unknown.
- `GET /api/get_analytics` — aggregates from SQLite.
- `GET /api/analytics/detailed` — same, plus per-model mean/min/max/std stats under `model_comparison_stats`.

## Frontend quirks (`frontend/app.js`)

- `API_BASE_URL` is set to `http://localhost:8000/api` only when the page is served on **port 5500** (Live Server default); otherwise it uses same-origin `/api`. If you serve the frontend on any other dev port while the backend runs on 8000, override the base URL or use a proxy — fetch calls will hit the frontend's own server and fail into offline simulation mode.
- Web Speech API (mic + TTS) requires Chrome/Edge; `app.js` already warns and degrades. `recognition.continuous = true` keeps the session open until the user clicks the mic again.
- If the backend is unreachable, the frontend falls back to a **simulated** evaluation with hardcoded fallback questions prefixed `[OFFLINE SIMULATION]`. This is intentional, not a bug.

## Backend quirks

- Sentence-transformers import is wrapped in `try/except`; if torch/st-transformers aren't installed, scoring silently falls back to TF-IDF-only.
- Difficulty threshold logic lives in `AdaptiveEngine.update_and_get_difficulty`: bumps up when smoothed score `> 0.75` (7.5/10), down when `< 0.4`. Smoothing is 0.7·current + 0.3·previous.
- Hybrid weights are fixed in `ai_engine.py::compute_hybrid_score`: 0.3·TF-IDF + 0.5·semantic + 0.2·LLM. Not configurable at runtime.
- The simulated LLM scoring in `scoring.py::compute_llm_quality` remains the **fallback** path for `evaluate_explanation`. Don't remove it — it's what runs when `USE_LLM=false` or when the LLM call fails.
- `interview_logs.csv` and `interview_logs.db` are auto-created on first evaluation; both are gitignored. Don't commit them.

## What not to do

- Don't look for tests, linters, typecheckers, or CI workflows — none are configured.
- Don't commit `backend/.env` or any file containing a real `HF_TOKEN`.
- Don't expect an OpenAI key to be picked up; the `openai` requirement entry is still aspirational — only the Hugging Face path is wired.
- Don't mount the frontend in a separate web server unless you also update `app.js`'s port-detection logic.
- Don't change the API response shape (the frontend depends on it exactly). If you add LLM fields, add them inside `evaluation` rather than at the top level.
