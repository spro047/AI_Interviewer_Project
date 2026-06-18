# AI-Powered Adaptive Mock Interview System
*A real-world project implementing a Hybrid Generative AI & NLP system.*

## 🌟 Publishable Novelty
As discussed in your prompt, the key factor that makes this project publishable (IEEE/Scopus level) is the **Hybrid Evaluation Engine** and **Adaptive Flow**:
1. **Semantic + Statistical Evaluation:** We combine `TF-IDF` (Statistical Keyword match) with `BERT` via sentence-transformers (Deep Semantic Meaning).
2. **Explainable AI:** Using an LLM (like GPT/Gemini) to not just score, but explain *why* the answer lacked certain context.
3. **Adaptive Difficulty:** Dynamically altering the state of the Interview Flow based on performance metrics.

---

## 🏗️ Project Architecture

We are building a decoupled architecture.

### 1. The FastAPI Backend (`/backend`)
A Python backend handling heavy NLP operations and APIs.
- `app.py`: FastAPI routes handling `/api/generate_question` and `/api/evaluate_answer`.
- `ai_engine.py`: The **Core Novelty** implementation. Holds the `HybridInterviewEngine` class.
- `requirements.txt`: Python dependencies (`fastapi`, `scikit-learn`, `sentence-transformers`, `openai`).

### 2. The Premium Vanilla Web App (`/frontend`)
A stunning, glassmorphism-themed frontend optimized to impress professors and reviewers.
- **Visuals:** Animated glowing orbs, blur backdrops, responsive grid layouts.
- **Analytics Dashboard:** Real-time visual tracking of TF-IDF score vs. BERT Score using animated SVG dials.
- **Chat Interface:** Human-like pacing with UI mimicking an actual AI interviewer.

---

## 🚀 Setup & Execution 

Here is how to run the project.

### Step 1: Start the Backend
First, install the AI Python libraries. (Ensure you have Python installed).
```bash
cd backend
pip install -r requirements.txt
python app.py
```
Then open `http://localhost:8000/` in your browser to use the mounted frontend.
*(Note: If you don't have Torch/Sentence-Transformers installed, the code is programmed to fallback gracefully so it won't crash!)*

### Step 2: Start the Frontend
You can directly open `index.html` in your browser, or use a tool like `npx serve` or Live Server.
```bash
cd frontend
npx serve .
```

---

## 🔬 Next Steps to "Finalize" the Paper
Once you run this code, you will have a working application demonstrating the novelty. 
To convert this fully to your IEEE paper:
1. Gather a dataset of ~50 answers using this app.
2. Observe the CSV metrics between `tfidf_match` and `semantic_match` provided by the backend logs.
3. Show graph implementations proving `BERT + GenAI` creates better feedback than legacy rule-based tools.

