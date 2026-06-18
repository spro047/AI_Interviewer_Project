import csv
import os
import sqlite3
import time
from typing import Dict, Any, List, Optional


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    cur = conn.execute(f"PRAGMA table_info({table})")
    return any(row[1] == column for row in cur.fetchall())


class InterviewLogger:
    def __init__(self, csv_file="interview_logs.csv", db_file="interview_logs.db"):
        self.csv_file = csv_file
        self.db_file = db_file
        self.setup_files()

    def setup_files(self):
        csv_has_data = os.path.exists(self.csv_file) and os.path.getsize(self.csv_file) > 0
        if not csv_has_data:
            with open(self.csv_file, mode='w', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                writer.writerow([
                    "session_id", "user_id", "created_at",
                    "question", "user_answer",
                    "tfidf_score", "bert_score", "llm_score", "final_score",
                    "difficulty_level", "confidence_score"
                ])

        conn = sqlite3.connect(self.db_file)
        c = conn.cursor()
        c.execute('''
            CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                question TEXT,
                user_answer TEXT,
                tfidf_score REAL,
                bert_score REAL,
                llm_score REAL,
                final_score REAL,
                difficulty_level TEXT,
                confidence_score REAL DEFAULT 0.5
            )
        ''')
        if not _has_column(conn, "logs", "session_id"):
            c.execute("ALTER TABLE logs ADD COLUMN session_id TEXT DEFAULT ''")
        if not _has_column(conn, "logs", "user_id"):
            c.execute("ALTER TABLE logs ADD COLUMN user_id TEXT DEFAULT ''")
        if not _has_column(conn, "logs", "created_at"):
            c.execute("ALTER TABLE logs ADD COLUMN created_at TIMESTAMP DEFAULT ''")

        c.execute('''
            CREATE TABLE IF NOT EXISTS sessions (
                session_id TEXT PRIMARY KEY,
                user_id TEXT,
                role TEXT,
                topic TEXT,
                initial_difficulty TEXT,
                started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                ended_at TIMESTAMP,
                num_questions INTEGER DEFAULT 0,
                avg_score REAL DEFAULT 0,
                max_score REAL DEFAULT 0,
                min_score REAL DEFAULT 0
            )
        ''')
        c.execute("CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, started_at DESC)")
        c.execute("CREATE INDEX IF NOT EXISTS idx_logs_session ON logs(session_id, id)")

        conn.commit()
        conn.close()

    def ensure_session(self, session_id: str, user_id: str, role: str, topic: str, initial_difficulty: str) -> None:
        if not session_id:
            return
        conn = sqlite3.connect(self.db_file)
        c = conn.cursor()
        c.execute(
            "INSERT OR IGNORE INTO sessions (session_id, user_id, role, topic, initial_difficulty) VALUES (?, ?, ?, ?, ?)",
            (session_id, user_id or "default_user", role or "", topic or "", initial_difficulty or "medium"),
        )
        conn.commit()
        conn.close()

    def end_session(self, session_id: str) -> None:
        if not session_id:
            return
        conn = sqlite3.connect(self.db_file)
        c = conn.cursor()
        c.execute(
            '''
            UPDATE sessions
            SET ended_at = CURRENT_TIMESTAMP,
                num_questions = (SELECT COUNT(*) FROM logs WHERE logs.session_id = sessions.session_id),
                avg_score = COALESCE((SELECT AVG(final_score) FROM logs WHERE logs.session_id = sessions.session_id), 0),
                max_score = COALESCE((SELECT MAX(final_score) FROM logs WHERE logs.session_id = sessions.session_id), 0),
                min_score = COALESCE((SELECT MIN(final_score) FROM logs WHERE logs.session_id = sessions.session_id), 0)
            WHERE session_id = ?
            ''',
            (session_id,),
        )
        conn.commit()
        conn.close()

    def log_evaluation(self, data: Dict[str, Any]):
        session_id = data.get("session_id", "")
        user_id = data.get("user_id", "")
        created_at = data.get("created_at") or time.strftime("%Y-%m-%d %H:%M:%S")

        with open(self.csv_file, mode='a', newline='', encoding='utf-8') as f:
            writer = csv.writer(f)
            writer.writerow([
                session_id,
                user_id,
                created_at,
                data.get("question", ""),
                data.get("user_answer", ""),
                data.get("tfidf_score", 0.0),
                data.get("bert_score", 0.0),
                data.get("llm_score", 0.0),
                data.get("final_score", 0.0),
                data.get("difficulty_level", ""),
                data.get("confidence_score", 0.5)
            ])

        conn = sqlite3.connect(self.db_file)
        c = conn.cursor()
        c.execute('''
            INSERT INTO logs (session_id, user_id, created_at, question, user_answer, tfidf_score, bert_score, llm_score, final_score, difficulty_level, confidence_score)
            VALUES (?, ?, COALESCE(NULLIF(?, ''), CURRENT_TIMESTAMP), ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            session_id,
            user_id,
            created_at,
            data.get("question", ""),
            data.get("user_answer", ""),
            data.get("tfidf_score", 0.0),
            data.get("bert_score", 0.0),
            data.get("llm_score", 0.0),
            data.get("final_score", 0.0),
            data.get("difficulty_level", ""),
            data.get("confidence_score", 0.5)
        ))
        conn.commit()
        conn.close()

    def list_sessions(self, user_id: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
        conn = sqlite3.connect(self.db_file)
        c = conn.cursor()
        if user_id:
            c.execute(
                '''
                SELECT session_id, user_id, role, topic, initial_difficulty, started_at, ended_at,
                       num_questions, avg_score, max_score, min_score
                FROM sessions
                WHERE user_id = ? AND session_id <> ''
                ORDER BY COALESCE(ended_at, started_at) DESC
                LIMIT ?
                ''',
                (user_id, limit),
            )
        else:
            c.execute(
                '''
                SELECT session_id, user_id, role, topic, initial_difficulty, started_at, ended_at,
                       num_questions, avg_score, max_score, min_score
                FROM sessions
                WHERE session_id <> ''
                ORDER BY COALESCE(ended_at, started_at) DESC
                LIMIT ?
                ''',
                (limit,),
            )
        rows = c.fetchall()
        conn.close()
        return [self._row_to_session_summary(r) for r in rows]

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        conn = sqlite3.connect(self.db_file)
        c = conn.cursor()
        c.execute(
            '''
            SELECT session_id, user_id, role, topic, initial_difficulty, started_at, ended_at,
                   num_questions, avg_score, max_score, min_score
            FROM sessions WHERE session_id = ?
            ''',
            (session_id,),
        )
        row = c.fetchone()
        if not row:
            conn.close()
            return None
        session = self._row_to_session_summary(row)

        c.execute(
            '''
            SELECT id, question, user_answer, tfidf_score, bert_score, llm_score, final_score,
                   difficulty_level, confidence_score, created_at
            FROM logs WHERE session_id = ? ORDER BY id ASC
            ''',
            (session_id,),
        )
        questions = []
        for r in c.fetchall():
            questions.append({
                "id": r[0],
                "question": r[1],
                "user_answer": r[2],
                "scores": {
                    "tfidf": round(r[3] or 0, 3),
                    "bert": round(r[4] or 0, 3),
                    "llm": round(r[5] or 0, 3),
                    "final": round(r[6] or 0, 3),
                },
                "difficulty_level": r[7] or "",
                "confidence_score": round(r[8] or 0, 3),
                "created_at": r[9] or "",
            })
        conn.close()
        session["questions"] = questions
        return session

    def _row_to_session_summary(self, row) -> Dict[str, Any]:
        return {
            "session_id": row[0],
            "user_id": row[1] or "",
            "role": row[2] or "",
            "topic": row[3] or "",
            "initial_difficulty": row[4] or "",
            "started_at": row[5] or "",
            "ended_at": row[6] or "",
            "num_questions": row[7] or 0,
            "avg_score": round(row[8] or 0, 3),
            "max_score": round(row[9] or 0, 3),
            "min_score": round(row[10] or 0, 3),
        }

    def get_analytics(self):
        conn = sqlite3.connect(self.db_file)
        c = conn.cursor()

        c.execute('SELECT final_score FROM logs')
        scores = [row[0] for row in c.fetchall()]

        c.execute('SELECT tfidf_score, bert_score, llm_score, final_score FROM logs')
        model_scores = c.fetchall()

        c.execute('SELECT final_score, difficulty_level FROM logs')
        history = [{"score": row[0], "difficulty": row[1]} for row in c.fetchall()]

        conn.close()

        return {
            "score_distribution": scores,
            "model_comparisons": {
                "tfidf": [s[0] for s in model_scores],
                "bert": [s[1] for s in model_scores],
                "llm": [s[2] for s in model_scores],
                "hybrid": [s[3] for s in model_scores]
            },
            "performance_over_time": history
        }
