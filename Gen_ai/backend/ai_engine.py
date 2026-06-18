from functools import lru_cache
import os
import random
import numpy as np
from scoring import ScoringEngine
from adaptive import AdaptiveEngine
from logger import InterviewLogger

try:
    from sentence_transformers import SentenceTransformer
    HAS_SENTENCE_TRANSFORMERS = True
except ImportError:
    HAS_SENTENCE_TRANSFORMERS = False

QUESTION_BANK = [
    ("Explain the fundamental concept of {topic} in your own words.",
     "Provide a clear definition, its purpose, and a real-world analogy.",
     ["easy", "medium", "hard"]),
    ("What is {topic}? Define it and provide a simple example.",
     "A clear definition with a concrete, easy-to-understand example.",
     ["easy", "medium", "hard"]),
    ("How would you explain {topic} to someone from a non-technical background?",
     "Use simple analogies and avoid jargon.",
     ["easy"]),
    ("What are the key components or building blocks of {topic}?",
     "List and describe the main components and how they interact.",
     ["easy", "medium"]),
    ("How would you design a {topic} system for a {role}?",
     "Discuss the architecture, key components, data flow, and trade-offs.",
     ["medium", "hard"]),
    ("What are the primary performance bottlenecks in {topic}, and how do you mitigate them?",
     "Identify common bottlenecks like I/O, memory, network, and discuss mitigation strategies such as caching, profiling, and optimization.",
     ["hard"]),
    ("Explain the core underlying principles of {topic} as if I am a junior developer.",
     "Break down the fundamental components without relying on excessive jargon.",
     ["easy"]),
    ("Can you walk me through a challenging bug or edge case you might encounter involving {topic}?",
     "Describe a realistic edge case, the debugging steps, and the architectural fix.",
     ["hard"]),
    ("Compare and contrast different approaches to solving {topic} problems.",
     "Discuss trade-offs, pros/cons, and when to use each approach.",
     ["medium", "hard"]),
    ("What best practices should a {role} follow when working with {topic}?",
     "Cover code standards, optimization techniques, and common pitfalls.",
     ["medium", "hard"]),
    ("How does {topic} integrate with other systems or technologies?",
     "Discuss APIs, data formats, protocols, and integration patterns.",
     ["medium"]),
    ("What are the security considerations for {topic}?",
     "Discuss authentication, authorization, data protection, and common vulnerabilities.",
     ["medium", "hard"]),
    ("How do you test and validate {topic} implementations?",
     "Discuss unit tests, integration tests, performance testing, and edge cases.",
     ["medium", "hard"]),
    ("What are the latest trends or developments in {topic}?",
     "Discuss recent advances, emerging patterns, and future directions.",
     ["medium", "hard"]),
    ("How would you troubleshoot a {topic} issue in production?",
     "Discuss debugging steps, monitoring, logging, and root cause analysis.",
     ["hard"]),
    ("Explain the role of {topic} in a microservices architecture.",
     "Discuss service communication, data consistency, and operational concerns.",
     ["hard"]),
    ("What are the cost implications of implementing {topic} at scale?",
     "Discuss infrastructure costs, licensing, and operational expenses.",
     ["medium", "hard"]),
    ("How would you scale {topic} from a small to a large user base?",
     "Discuss horizontal scaling, caching, load balancing, and database optimization.",
     ["hard"]),
    ("Walk me through a code example that demonstrates {topic}.",
     "Provide a clear code example with explanation of key parts.",
     ["easy", "medium"]),
    ("What are the common misconceptions or myths about {topic}?",
     "Identify myths and clarify the reality with examples.",
     ["medium", "hard"]),
    ("How does {topic} differ from related technologies or approaches?",
     "Highlight key differences and when to use each.",
     ["medium", "hard"]),
    ("What metrics would you use to measure the success of a {topic} implementation?",
     "Discuss KPIs, performance metrics, and business metrics.",
     ["medium", "hard"]),
    ("Describe the evolution of {topic} over the past few years.",
     "Discuss historical developments, current state, and future trends.",
     ["medium"]),
    ("How do you handle errors and exceptions in {topic}?",
     "Discuss error handling patterns, retries, circuit breakers, and logging.",
     ["medium", "hard"]),
    ("What are the accessibility considerations for {topic} interfaces?",
     "Discuss inclusive design and accessibility standards.",
     ["medium"]),
    ("How would you onboard a new team member to work on {topic}?",
     "Discuss documentation, training, mentorship, and code reviews.",
     ["medium"]),
    ("If you had to choose just one principle or rule to remember about {topic}, what would it be?",
     "Provide the most important takeaway with reasoning.",
     ["easy", "medium"]),
    ("Describe a real-world scenario where {topic} made a measurable difference.",
     "Provide a concrete scenario with outcomes.",
     ["medium", "hard"]),
    ("What are the limitations of {topic}?",
     "Identify scenarios where it falls short or alternatives are better.",
     ["medium", "hard"]),
    ("How do you keep your {topic} knowledge up to date?",
     "Discuss learning resources, communities, and practice strategies.",
     ["easy", "medium"]),
]

_SCORING_ENGINE = None


def _normalize_score(score: float) -> float:
    try:
        score = float(score)
    except (TypeError, ValueError):
        return 0.0

    return max(0.0, min(1.0, score))


def _get_scoring_engine() -> ScoringEngine:
    global _SCORING_ENGINE

    if _SCORING_ENGINE is None:
        _SCORING_ENGINE = ScoringEngine(use_bert=False)
    return _SCORING_ENGINE


@lru_cache(maxsize=1)
def _get_sentence_transformer():
    if not HAS_SENTENCE_TRANSFORMERS:
        return None

    try:
        return SentenceTransformer("all-MiniLM-L6-v2")
    except Exception:
        return None


@lru_cache(maxsize=128)
def _get_semantic_embedding(text: str):
    model = _get_sentence_transformer()
    if model is None or not text.strip():
        return None

    try:
        return model.encode(text)
    except Exception:
        return None


def compute_tfidf_score(answer, reference):
    score = _get_scoring_engine().compute_tfidf_score(answer or "", reference or "")
    return _normalize_score(score)


def compute_semantic_score(answer, reference):
    answer = answer or ""
    reference = reference or ""
    if not answer.strip() or not reference.strip():
        return 0.0

    answer_embedding = _get_semantic_embedding(answer)
    reference_embedding = _get_semantic_embedding(reference)
    if answer_embedding is None or reference_embedding is None:
        return compute_tfidf_score(answer, reference)

    denominator = np.linalg.norm(answer_embedding) * np.linalg.norm(reference_embedding)
    if denominator == 0:
        return 0.0

    score = np.dot(answer_embedding, reference_embedding) / denominator
    return _normalize_score(score)


def compute_llm_score(answer, reference):
    answer = answer or ""
    reference = reference or ""
    if not answer.strip() or not reference.strip():
        return 0.0

    llm_response = _get_scoring_engine().compute_llm_quality(answer, reference, "")
    return _normalize_score(llm_response.get("llm_score", 0.0))


def compute_hybrid_score(tfidf_score, semantic_score, llm_score):
    final_score = (
        0.3 * _normalize_score(tfidf_score)
        + 0.5 * _normalize_score(semantic_score)
        + 0.2 * _normalize_score(llm_score)
    )
    return _normalize_score(final_score)


class HybridInterviewEngine:
    def __init__(self, use_bert=True, use_llm: bool | None = None):
        self.scoring = ScoringEngine(use_bert=use_bert)
        self.adaptive = AdaptiveEngine()
        self.logger = InterviewLogger()
        self.llm = None

        if use_llm is None:
            use_llm = os.environ.get("USE_LLM", "false").strip().lower() in ("1", "true", "yes")

        if use_llm:
            try:
                from llm import LLMClient
                self.llm = LLMClient()
            except Exception as e:
                print(f"[ai_engine] LLM init failed, falling back to template/heuristic: {e}")
                self.llm = None

    def generate_question(self, role: str, topic: str, difficulty: str, history: list = None) -> tuple[str, str]:
        if self.llm is not None:
            try:
                return self.llm.generate_question(role, topic, difficulty, history)
            except Exception as e:
                print(f"[ai_engine] LLM generate_question failed, falling back to template bank: {e}")

        if history is None:
            history = []

        diff = (difficulty or "medium").lower()

        available = [
            (template, ideal)
            for (template, ideal, levels) in QUESTION_BANK
            if diff in levels
        ]
        if not available:
            available = [(t, i) for (t, i, _) in QUESTION_BANK]

        asked = set()
        last_question = ""
        for entry in history:
            if isinstance(entry, str):
                asked.add(entry)
                last_question = entry
            elif isinstance(entry, dict):
                q = entry.get("question", "")
                if q:
                    asked.add(q)
                    last_question = q

        formatted = [(t.format(role=role, topic=topic), i) for (t, i) in available]
        unasked = [(q, i) for (q, i) in formatted if q not in asked]

        pool = unasked if unasked else formatted

        if last_question and len(pool) > 1:
            filtered_pool = [(q, i) for (q, i) in pool if q != last_question]
            if filtered_pool:
                pool = filtered_pool

        return random.choice(pool)

    def evaluate_answer_hybrid(
        self,
        user_id: str,
        question: str,
        user_answer: str,
        ideal_answer: str,
        current_difficulty: str,
        topic: str = "",
        role: str = "",
        session_id: str = "",
    ):

        # 1. Calculate base scores
        tfidf_score = compute_tfidf_score(user_answer, ideal_answer)
        semantic_score = compute_semantic_score(user_answer, ideal_answer)
        rule_score = self.scoring.compute_rule_based_score(user_answer, ideal_answer)
        confidence_score = self.scoring.compute_confidence_score(user_answer)

        if session_id:
            self.logger.ensure_session(session_id, user_id, role, topic, current_difficulty)
        
        # 2. LLM evaluation and structured JSON
        if self.llm is not None:
            try:
                llm_payload = self.llm.evaluate_explanation(
                    question=question,
                    user_answer=user_answer,
                    ideal_answer=ideal_answer,
                    base_metrics={"tfidf": tfidf_score, "semantic": semantic_score},
                )
                llm_score = llm_payload["llm_score"]
                structured_json = {
                    "concept_coverage": llm_payload["concept_coverage"],
                    "depth": llm_payload["depth"],
                    "clarity": llm_payload["clarity"],
                    "missing_concepts": llm_payload["missing_concepts"],
                    "improvement_suggestions": llm_payload["improvement_suggestions"],
                }
            except Exception as e:
                print(f"[ai_engine] LLM evaluate_explanation failed, falling back to heuristic: {e}")
                llm_score = compute_llm_score(user_answer, ideal_answer)
                llm_eval = self.scoring.compute_llm_quality(user_answer, ideal_answer, question)
                structured_json = llm_eval["structured_json"]
        else:
            llm_score = compute_llm_score(user_answer, ideal_answer)
            llm_eval = self.scoring.compute_llm_quality(user_answer, ideal_answer, question)
            structured_json = llm_eval["structured_json"]

        # 3. Final hybrid score
        final_score = compute_hybrid_score(tfidf_score, semantic_score, llm_score)
        adaptive_score = final_score * 10.0
        
        # 4. Baseline model scores for comparison
        tfidf_only = self.scoring.compute_tfidf_only_score(user_answer, ideal_answer)
        semantic_only = self.scoring.compute_semantic_only_score(user_answer, ideal_answer)
        
        # 5. Adaptive difficulty
        next_difficulty = self.adaptive.update_and_get_difficulty(user_id, current_difficulty, adaptive_score)
        
        # 6. Log results
        self.logger.log_evaluation({
            "session_id": session_id,
            "user_id": user_id,
            "question": question,
            "user_answer": user_answer,
            "tfidf_score": tfidf_score,
            "bert_score": semantic_score,
            "llm_score": llm_score,
            "final_score": final_score,
            "difficulty_level": current_difficulty,
            "confidence_score": confidence_score
        })
        
        return {
            "tfidf_score": round(tfidf_score, 2),
            "semantic_score": round(semantic_score, 2),
            "bert_score": round(semantic_score, 2),
            "llm_score": round(llm_score, 2),
            "rule_based_score": round(rule_score, 2),
            "final_score": round(final_score, 2),
            "confidence_score": round(confidence_score, 2),
            "difficulty_level": next_difficulty,
            "next_difficulty": next_difficulty,
            "explanation": structured_json,
            "baseline_models": {
                "tfidf_only": round(tfidf_only, 2),
                "semantic_only": round(semantic_only, 2),
                "rule_based": round(rule_score, 2),
                "hybrid": round(final_score, 2)
            },
            "model_performance": {
                "best_model": max(
                    [("tfidf", tfidf_only), ("semantic", semantic_only), ("hybrid", final_score)],
                    key=lambda x: x[1]
                )[0],
                "worst_model": min(
                    [("tfidf", tfidf_only), ("semantic", semantic_only), ("hybrid", final_score)],
                    key=lambda x: x[1]
                )[0]
            }
        }
        
    def get_analytics(self):
        return self.logger.get_analytics()

    def list_sessions(self, user_id: str = None, limit: int = 50):
        return self.logger.list_sessions(user_id=user_id, limit=limit)

    def get_session(self, session_id: str):
        return self.logger.get_session(session_id)

    def end_session(self, session_id: str):
        self.logger.end_session(session_id)
