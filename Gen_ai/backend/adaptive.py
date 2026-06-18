from typing import Dict

class AdaptiveEngine:
    def __init__(self):
        # Maps user_id -> list of previous scores
        self.user_sessions: Dict[str, list] = {}
        self.levels = ["easy", "medium", "hard"]

    def update_and_get_difficulty(self, user_id: str, current_difficulty: str, current_score: float) -> str:
        # Scale score from 1-10 to 0-1 for difficulty logic
        normalized_score = current_score / 10.0
        
        if user_id not in self.user_sessions:
            self.user_sessions[user_id] = []
            
        history = self.user_sessions[user_id]
        
        if not history:
            performance_t = normalized_score
        else:
            previous_score = history[-1] / 10.0
            performance_t = 0.7 * normalized_score + 0.3 * previous_score
            
        history.append(current_score)
        
        idx = self.levels.index(current_difficulty.lower()) if current_difficulty.lower() in self.levels else 1
        
        if performance_t > 0.75 and idx < len(self.levels) - 1:
            return self.levels[idx + 1]
        elif performance_t < 0.4 and idx > 0:
            return self.levels[idx - 1]
            
        return self.levels[idx]
