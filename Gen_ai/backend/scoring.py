import numpy as np
import json
import re
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from functools import lru_cache

try:
    from sentence_transformers import SentenceTransformer
    HAS_SENTENCE_TRANSFORMERS = True
except ImportError:
    HAS_SENTENCE_TRANSFORMERS = False

# Uncertainty/confidence detection patterns
UNCERTAINTY_PATTERNS = [
    r'\b(i\s+think|maybe|probably|might|possibly|seems|appears|could|perhaps|somewhat|unclear)\b',
    r'\b(uh|um|er|like|basically|you\s+know|sort\s+of|kind\s+of)\b',
    r'not\s+sure',
    r'\?'
]

class ScoringEngine:
    def __init__(self, use_bert=True, alpha=0.3, beta=0.5, gamma=0.2):
        self.tfidf_vectorizer = TfidfVectorizer()
        self.use_bert = use_bert and HAS_SENTENCE_TRANSFORMERS
        
        self.alpha = alpha
        self.beta = beta
        self.gamma = gamma
        
        if self.use_bert:
            print("Loading BERT Model for Semantic Analysis...")
            self.bert_model = SentenceTransformer('all-MiniLM-L6-v2')

    def set_weights(self, alpha: float, beta: float, gamma: float):
        self.alpha = alpha
        self.beta = beta
        self.gamma = gamma

    def compute_tfidf_score(self, answer: str, reference: str) -> float:
        if not answer.strip() or not reference.strip():
            return 0.0
        try:
            tfidf_matrix = self.tfidf_vectorizer.fit_transform([reference, answer])
            score = cosine_similarity(tfidf_matrix[0:1], tfidf_matrix[1:2])[0][0]
            return float(score)
        except Exception:
            return 0.0

    # Caching embeddings for performance optimization
    @lru_cache(maxsize=128)
    def _get_embedding(self, text: str):
        if not self.use_bert:
            return None
        return self.bert_model.encode(text)

    def compute_bert_similarity(self, answer: str, reference: str) -> float:
        if not self.use_bert:
            return self.compute_tfidf_score(answer, reference)
            
        if not answer.strip() or not reference.strip():
            return 0.0
            
        ref_embedding = self._get_embedding(reference)
        ans_embedding = self._get_embedding(answer)
        
        if ref_embedding is None or ans_embedding is None:
            return 0.0
            
        score = np.dot(ref_embedding, ans_embedding) / (np.linalg.norm(ref_embedding) * np.linalg.norm(ans_embedding))
        return float(max(0.0, score))

    def compute_rule_based_score(self, answer: str, reference: str) -> float:
        # Baseline model 3: simple keyword matching
        ref_words = set(reference.lower().split())
        ans_words = set(answer.lower().split())
        if not ref_words:
            return 0.0
        overlap = ref_words.intersection(ans_words)
        return len(overlap) / len(ref_words)

    def compute_concept_coverage_clustering(self, answer: str, reference: str) -> float:
        # Bonus Feature: Concept coverage scoring using semantic clustering
        # We divide reference into chunks (pseudo clusters) and check if answer covers them
        chunks = [c.strip() for c in reference.split('.') if len(c.strip()) > 10]
        if not chunks:
            return self.compute_bert_similarity(answer, reference)
            
        coverage = 0
        for chunk in chunks:
            sim = self.compute_bert_similarity(answer, chunk)
            if sim > 0.4: # Threshold for covering a chunk
                coverage += 1
        return coverage / len(chunks)

    def compute_llm_quality(self, answer: str, reference: str, question: str) -> dict:
        """
        Simulates an LLM structured evaluation.
        In production, replace with actual OpenAI API call.
        """
        ans_len = len(answer.split())
        ref_len = len(reference.split())
        
        clarity = min(1.0, ans_len / max(1, ref_len) * 1.2)
        depth = min(1.0, self.compute_bert_similarity(answer, reference) * 1.5)
        concept_cov = self.compute_concept_coverage_clustering(answer, reference)
        
        # Ensure values are between 0 and 1
        clarity = max(0.0, min(1.0, clarity))
        depth = max(0.0, min(1.0, depth))
        concept_cov = max(0.0, min(1.0, concept_cov))
        
        llm_score = (clarity + depth + concept_cov) / 3.0
        
        # Enhanced missing concepts detection
        missing = []
        if concept_cov < 0.7:
            missing = ["edge cases", "performance considerations", "system design aspects"]
        if clarity < 0.6:
            missing.append("technical precision in terminology")
        if depth < 0.5:
            missing.append("deeper analysis and examples")
        
        # Enhanced improvement suggestions
        improvements = []
        if clarity < 0.7:
            improvements.append("Use more technical terminology and precise language")
        if depth < 0.7:
            improvements.append("Provide more detailed explanations and examples")
        if concept_cov < 0.7:
            improvements.append("Cover more aspects of the topic")
        if not improvements:
            improvements = ["Excellent response! Keep this level of detail."]
        
        return {
            "llm_score": float(llm_score),
            "structured_json": {
                "concept_coverage": float(concept_cov),
                "depth": float(depth),
                "clarity": float(clarity),
                "missing_concepts": list(set(missing)),
                "improvement_suggestions": list(set(improvements))
            }
        }

    def compute_final_score(self, tfidf: float, bert: float, llm: float) -> float:
        score = self.alpha * tfidf + self.beta * bert + self.gamma * llm
        # scale from 0-1 to 0-10 for frontend
        return max(0.0, min(10.0, score * 10.0))

    def compute_confidence_score(self, answer: str) -> float:
        """
        Detect uncertainty words in answer to estimate confidence.
        Returns score between 0-1 (1 = very confident, 0 = very uncertain).
        """
        if not answer.strip():
            return 0.0
        
        answer_lower = answer.lower()
        uncertainty_count = 0
        word_count = len(answer_lower.split())
        
        for pattern in UNCERTAINTY_PATTERNS:
            matches = re.findall(pattern, answer_lower, re.IGNORECASE)
            uncertainty_count += len(matches)
        
        # Normalize uncertainty to confidence score
        uncertainty_ratio = min(1.0, uncertainty_count / max(1, word_count / 10))
        confidence = 1.0 - uncertainty_ratio
        return max(0.0, min(1.0, confidence))
    
    def compute_tfidf_only_score(self, answer: str, reference: str) -> float:
        """Baseline: TF-IDF only scoring (statistical keyword match)."""
        return self.compute_tfidf_score(answer, reference)
    
    def compute_semantic_only_score(self, answer: str, reference: str) -> float:
        """Baseline: Semantic/BERT only scoring (deep semantic meaning)."""
        return self.compute_bert_similarity(answer, reference)
    
    def compute_hybrid_score(self, tfidf: float, semantic: float, llm: float) -> float:
        """Combined hybrid score using weighted average."""
        return self.compute_final_score(tfidf, semantic, llm)
