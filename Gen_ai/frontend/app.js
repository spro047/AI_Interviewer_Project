// Dynamically set API URL based on environment (supports Live Server on :5500)
const API_BASE_URL = window.location.port === '5500' ? 'http://localhost:8000/api' : '/api';

// =====================================================
// State
// =====================================================
let currentQuestion = '';
let currentIdealAnswer = '';
let currentDifficulty = 'medium';
let currentTopic = '';
let currentRole = '';
let currentSessionId = '';
let interviewHistory = [];

const USER_ID_KEY = 'aiInterviewUserId';

function generateUserId() {
    return `user_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
}

function getUserId() {
    let stored = localStorage.getItem(USER_ID_KEY);
    if (!stored) {
        stored = generateUserId();
        localStorage.setItem(USER_ID_KEY, stored);
    }
    return stored;
}

function generateSessionId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const userId = getUserId();

// =====================================================
// DOM
// =====================================================
const views = document.querySelectorAll('.view');
const sessionList = document.getElementById('sessionList');
const refreshSessionsBtn = document.getElementById('refreshSessionsBtn');
const userIdLabel = document.getElementById('userIdLabel');

const startBtn = document.getElementById('startBtn');
const roleSelect = document.getElementById('roleSelect');
const topicSelect = document.getElementById('topicSelect');
const diffBtns = document.querySelectorAll('.diff-pill');
const levelBadge = document.getElementById('levelBadge');
const roleLabel = document.getElementById('roleLabel');
const topicLabel = document.getElementById('topicLabel');

const chatbox = document.getElementById('chatbox');
const answerInput = document.getElementById('answerInput');
const submitBtn = document.getElementById('submitBtn');
const micBtn = document.getElementById('micBtn');
const recordingIndicator = document.getElementById('recordingIndicator');

const scorePath = document.getElementById('scorePath');
const scoreText = document.getElementById('scoreText');
const semanticBar = document.getElementById('semanticBar');
const semanticVal = document.getElementById('semanticVal');
const keywordBar = document.getElementById('keywordBar');
const keywordVal = document.getElementById('keywordVal');
const llmBar = document.getElementById('llmBar');
const llmVal = document.getElementById('llmVal');
const feedbackBox = document.getElementById('feedbackBox');
const timeVal = document.getElementById('timeVal');
const downloadPdfBtn = document.getElementById('downloadPdfBtn');

const endBtn = document.getElementById('endBtn');
const restartBtn = document.getElementById('restartBtn');

const pastModal = document.getElementById('pastModal');
const pastModalBody = document.getElementById('pastModalBody');
const pastModalTitle = document.getElementById('pastModalTitle');

if (userIdLabel) userIdLabel.textContent = userId;

// =====================================================
// View switching
// =====================================================
function showView(name) {
    views.forEach(v => {
        if (v.dataset.view === name) v.removeAttribute('hidden');
        else v.setAttribute('hidden', '');
    });
}

// =====================================================
// Speech Recognition
// =====================================================
let isRecording = false;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let sessionBase = '';
let latestInterim = '';

if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = function() {
        isRecording = true;
        sessionBase = answerInput.value;
        latestInterim = '';
        if (recordingIndicator) recordingIndicator.hidden = false;
        if (micBtn) micBtn.innerHTML = '<i class="fa-solid fa-stop"></i>';
    };

    recognition.onresult = function(event) {
        let finalDelta = '';
        latestInterim = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
                finalDelta += (finalDelta ? ' ' : '') + transcript;
            } else {
                latestInterim = transcript;
            }
        }
        if (finalDelta) {
            sessionBase += (sessionBase && !sessionBase.endsWith(' ') ? ' ' : '') + finalDelta;
        }
        answerInput.value = sessionBase + (latestInterim ? ' ' + latestInterim : '');
    };

    recognition.onend = function() {
        if (latestInterim) {
            sessionBase += (sessionBase && !sessionBase.endsWith(' ') ? ' ' : '') + latestInterim;
            answerInput.value = sessionBase;
            latestInterim = '';
        }
        stopRecording();
    };

    recognition.onerror = function(event) {
        console.error('Speech recognition error:', event.error);
        if (event.error === 'aborted') {
            stopRecording();
            return;
        }
        let msg = 'Speech recognition error: ' + event.error;
        if (event.error === 'no-speech') msg = 'No speech detected. Please try again.';
        else if (event.error === 'audio-capture') msg = 'No microphone found.';
        else if (event.error === 'not-allowed' || event.error === 'service-not-allowed') msg = 'Microphone access denied. Please allow it in browser settings.';
        else if (event.error === 'network') msg = 'Network error. Speech recognition requires an internet connection.';
        if (recordingIndicator) {
            recordingIndicator.innerHTML = '<i class="fa-solid fa-exclamation-triangle"></i> ' + msg;
            recordingIndicator.hidden = false;
            setTimeout(() => {
                if (recordingIndicator) {
                    recordingIndicator.hidden = true;
                    recordingIndicator.innerHTML = '<i class="fa-solid fa-microphone fa-beat"></i> Listening...';
                }
            }, 3000);
        } else {
            alert(msg);
        }
        isRecording = false;
        if (micBtn) micBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
    };
} else {
    console.warn('Speech Recognition API not supported in this browser.');
}

function stopRecording() {
    isRecording = false;
    if (recordingIndicator) {
        recordingIndicator.hidden = true;
        recordingIndicator.innerHTML = '<i class="fa-solid fa-microphone fa-beat"></i> Listening...';
    }
    if (micBtn) micBtn.innerHTML = '<i class="fa-solid fa-microphone"></i>';
}

if (micBtn) {
    micBtn.addEventListener('click', () => {
        if (!SpeechRecognition) {
            alert('Speech Recognition is not supported in this browser (try Chrome/Edge).');
            return;
        }
        if (isRecording) {
            recognition.stop();
        } else {
            try {
                recognition.start();
            } catch (e) {
                console.error('Failed to start recognition:', e);
                stopRecording();
            }
        }
    });
}

// =====================================================
// Text-to-Speech
// =====================================================
const synth = window.speechSynthesis;

function speakText(text) {
    if (!synth) return;
    if (synth.speaking) synth.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    const preferredVoice = voices.find(v => v.lang === 'en-US' && v.name.includes('Google')) || voices.find(v => v.lang.includes('en'));
    if (preferredVoice) utterance.voice = preferredVoice;
    utterance.rate = 0.95;
    utterance.pitch = 1.0;
    synth.speak(utterance);
}

// =====================================================
// Difficulty toggle
// =====================================================
diffBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        diffBtns.forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        currentDifficulty = e.currentTarget.dataset.val;
    });
});

// =====================================================
// Setup -> Interview
// =====================================================
if (startBtn) {
    startBtn.addEventListener('click', async () => {
        currentRole = (roleSelect && roleSelect.value) || 'Software Engineer';
        currentTopic = (topicSelect && topicSelect.value) || 'Computer Networks';
        currentSessionId = generateSessionId();
        interviewHistory = [];

        resetLivePanel();
        if (roleLabel) roleLabel.textContent = currentRole;
        if (topicLabel) topicLabel.textContent = currentTopic;
        updateBadge();

        showView('interview');
        await fetchNextQuestion();
    });
}

// =====================================================
// Submit answer
// =====================================================
if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
        const answer = answerInput.value.trim();
        if (!answer) return;

        appendMessage(answer, 'user');
        answerInput.value = '';
        sessionBase = '';
        latestInterim = '';

        const typingId = appendMessage('<i class="fa-solid fa-ellipsis fa-fade"></i> AI is evaluating using Hybrid NLP...', 'system');
        await submitAnswer(answer, typingId);
    });
}

if (answerInput) {
    answerInput.addEventListener('keypress', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submitBtn.click();
        }
    });
}

// =====================================================
// End / Restart
// =====================================================
if (endBtn) {
    endBtn.addEventListener('click', async () => {
        if (synth && synth.speaking) synth.cancel();
        if (timeInterval) clearInterval(timeInterval);

        if (currentSessionId) {
            try {
                await fetch(`${API_BASE_URL}/end_session`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ session_id: currentSessionId })
                });
            } catch (e) {
                console.warn('end_session failed:', e);
            }
        }

        showView('report');
        generateReport();
        loadSessions();
    });
}

if (restartBtn) {
    restartBtn.addEventListener('click', () => {
        currentSessionId = generateSessionId();
        interviewHistory = [];
        resetLivePanel();
        if (roleLabel) roleLabel.textContent = currentRole;
        if (topicLabel) topicLabel.textContent = currentTopic;
        updateBadge();
        if (chatbox) {
            chatbox.innerHTML = '<div class="chat-empty">System initialized. The first question is on its way.</div>';
        }
        showView('interview');
        fetchNextQuestion();
    });
}

if (downloadPdfBtn) downloadPdfBtn.addEventListener('click', downloadReportPdf);

const backToStartBtn = document.getElementById('backToStartBtn');
if (backToStartBtn) {
    backToStartBtn.addEventListener('click', () => {
        if (synth && synth.speaking) synth.cancel();
        if (timeInterval) clearInterval(timeInterval);
        timeInterval = null;
        sessionBase = '';
        latestInterim = '';
        isRecording = false;
        interviewHistory = [];
        resetLivePanel();
        if (chatbox) {
            chatbox.innerHTML = '<div class="chat-empty">System initialized. The first question is on its way.</div>';
        }
        showView('setup');
    });
}

if (refreshSessionsBtn) refreshSessionsBtn.addEventListener('click', loadSessions);

// =====================================================
// Theme toggle (light / dark)
// =====================================================
const THEME_KEY = 'aiInterviewTheme';
const themeToggle = document.getElementById('themeToggle');
const themeLabelText = document.getElementById('themeLabelText');

function applyTheme(theme) {
    const isDark = theme === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    if (themeToggle) themeToggle.setAttribute('aria-checked', isDark ? 'true' : 'false');
    if (themeLabelText) themeLabelText.textContent = isDark ? 'Dark' : 'Light';
}

function getStoredTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
}

function setStoredTheme(theme) {
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* ignore */ }
}

(function initTheme() {
    const stored = getStoredTheme();
    const initial = stored || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyTheme(initial);
})();

if (themeToggle) {
    themeToggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        applyTheme(next);
        setStoredTheme(next);
    });
}

// =====================================================
// Preset cards (quick start)
// =====================================================
document.querySelectorAll('.preset').forEach(btn => {
    btn.addEventListener('click', () => {
        const role = btn.dataset.role;
        const topic = btn.dataset.topic;
        const diff = btn.dataset.difficulty || 'medium';
        if (role && roleSelect) {
            const opt = Array.from(roleSelect.options).find(o => o.value === role);
            if (opt) roleSelect.value = role;
        }
        if (topic && topicSelect) {
            const opt = Array.from(topicSelect.options).find(o => o.value === topic);
            if (opt) topicSelect.value = topic;
        }
        diffBtns.forEach(b => {
            b.classList.toggle('active', b.dataset.val === diff);
        });
        currentDifficulty = diff;
    });
});

// =====================================================
// Past session modal
// =====================================================
if (pastModal) {
    pastModal.querySelectorAll('[data-close]').forEach(el => {
        el.addEventListener('click', closePastSession);
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !pastModal.hidden) closePastSession();
    });
}

function openPastSession(sessionId) {
    if (!pastModal) return;
    pastModal.hidden = false;
    pastModalBody.innerHTML = '<p class="session-empty">Loading...</p>';
    fetch(`${API_BASE_URL}/sessions/${encodeURIComponent(sessionId)}`)
        .then(r => {
            if (!r.ok) throw new Error('Session not found');
            return r.json();
        })
        .then(session => renderPastSession(session))
        .catch(err => {
            pastModalBody.innerHTML = `<p class="session-empty">${escapeHtml(err.message)}</p>`;
        });
}

function closePastSession() {
    if (pastModal) pastModal.hidden = true;
}

function renderPastSession(session) {
    const started = session.started_at || '';
    const ended = session.ended_at || '';
    const avgPct = (session.avg_score * 10).toFixed(2);
    pastModalTitle.textContent = `${session.role || 'Interview'} · ${session.topic || ''}`.trim();

    let body = `
        <div class="past-summary">
            <span class="past-summary-item">Started<strong>${escapeHtml(started)}</strong></span>
            <span class="past-summary-item">Ended<strong>${escapeHtml(ended || '—')}</strong></span>
            <span class="past-summary-item">Questions<strong>${session.num_questions}</strong></span>
            <span class="past-summary-item">Avg score<strong>${avgPct}/10</strong></span>
            <span class="past-summary-item">Difficulty<strong>${escapeHtml(session.initial_difficulty || '—')}</strong></span>
        </div>
    `;

    if (!session.questions || session.questions.length === 0) {
        body += '<p class="session-empty">No questions were answered in this session.</p>';
    } else {
        body += session.questions.map((q, idx) => {
            const finalScore = (q.scores.final || 0) * 10;
            const cls = scoreClass(finalScore);
            const label = scoreLabel(finalScore);
            return `
                <div class="past-question ${cls}">
                    <div class="past-question-q">Q${idx + 1}. ${escapeHtml(q.question)}</div>
                    <div class="past-question-a">"${escapeHtml(q.user_answer || '(no answer recorded)')}"</div>
                    <div class="past-question-meta">
                        <span class="q-tag q-num">${idx + 1}</span>
                        <span class="q-tag q-score-${cls.replace('q-', '')}">${label} · ${finalScore.toFixed(2)}/10</span>
                        <span class="q-tag q-diff">${escapeHtml(q.difficulty_level || '—')}</span>
                    </div>
                </div>
            `;
        }).join('');
    }

    pastModalBody.innerHTML = body;
}

// =====================================================
// Sidebar: load & render sessions
// =====================================================
async function loadSessions() {
    if (!sessionList) return;
    sessionList.innerHTML = '<p class="session-empty">Loading...</p>';
    try {
        const res = await fetch(`${API_BASE_URL}/sessions?user_id=${encodeURIComponent(userId)}&limit=30`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const sessions = data.sessions || [];
        renderSessionList(sessions);
    } catch (e) {
        console.error('Failed to load sessions:', e);
        sessionList.innerHTML = '<p class="session-empty">Could not load sessions.</p>';
    }
}

function renderSessionList(sessions) {
    if (!sessions || sessions.length === 0) {
        sessionList.innerHTML = '<p class="session-empty">No past interviews yet.</p>';
        return;
    }

    sessionList.innerHTML = sessions.map(s => {
        const date = formatSessionDate(s.started_at);
        const scorePct = (s.avg_score || 0) * 10;
        const scoreCls = scorePct >= 7 ? 'score-high' : (scorePct >= 4 ? 'score-mid' : 'score-low');
        return `
            <button class="session-item" data-session-id="${escapeHtml(s.session_id)}">
                <div class="session-item-date">${escapeHtml(date)}</div>
                <div class="session-item-title">${escapeHtml(s.role || 'Interview')}</div>
                <div class="session-item-sub">${escapeHtml(s.topic || '')}${s.num_questions ? ' · ' + s.num_questions + ' Q' : ''}</div>
                <div class="session-item-score ${scoreCls}">${scorePct.toFixed(2)}/10</div>
            </button>
        `;
    }).join('');

    sessionList.querySelectorAll('.session-item').forEach(el => {
        el.addEventListener('click', () => {
            const id = el.dataset.sessionId;
            if (id) openPastSession(id);
        });
    });
}

function formatSessionDate(iso) {
    if (!iso) return '';
    const d = new Date(iso.replace(' ', 'T'));
    if (isNaN(d.getTime())) return iso;
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return `Today, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) {
        return `Yesterday, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) +
        ` · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

// =====================================================
// Interview flow
// =====================================================
let questionStartTime = 0;
let timeInterval = null;

function updateBadge() {
    if (levelBadge) {
        const cap = currentDifficulty.charAt(0).toUpperCase() + currentDifficulty.slice(1);
        levelBadge.textContent = cap;
    }
}

function resetLivePanel() {
    if (scorePath) scorePath.setAttribute('stroke-dasharray', '0, 100');
    if (scoreText) scoreText.textContent = '--';
    [semanticBar, keywordBar, llmBar].forEach(b => { if (b) b.style.width = '0%'; });
    [semanticVal, keywordVal, llmVal].forEach(v => { if (v) v.textContent = '--'; });
    if (feedbackBox) {
        feedbackBox.classList.add('empty');
        feedbackBox.innerHTML = 'Submit an answer to see AI insights.';
    }
}

function appendMessage(text, sender) {
    if (!chatbox) return null;
    const div = document.createElement('div');
    const id = 'msg-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    div.id = id;
    div.classList.add('message');

    if (sender === 'ai') {
        div.classList.add('message-ai');
        const safeText = String(text).replace(/"/g, '&quot;').replace(/'/g, "&#39;").replace(/\n/g, ' ');
        const parsedText = (typeof marked !== 'undefined') ? marked.parse(text) : text;
        div.innerHTML = `
            <div class="msg-content">${parsedText}</div>
            <div class="msg-meta">
                <button class="read-aloud-btn" onclick="speakText('${safeText}')" title="Read aloud">
                    <i class="fa-solid fa-volume-high"></i>
                    <span>Read aloud</span>
                </button>
            </div>
        `;
    } else if (sender === 'user') {
        div.classList.add('message-user');
        div.innerHTML = `<div class="msg-content">${escapeHtml(text)}</div>`;
    } else {
        div.classList.add('message-system');
        const parsedText = (typeof marked !== 'undefined') ? marked.parse(text) : escapeHtml(text);
        div.innerHTML = `<div class="msg-content">${parsedText}</div>`;
    }

    const empty = chatbox.querySelector('.chat-empty');
    if (empty) empty.remove();

    chatbox.appendChild(div);
    chatbox.scrollTop = chatbox.scrollHeight;
    return id;
}

function updateMessage(id, newText, senderClass) {
    const el = id ? document.getElementById(id) : null;
    if (!el) return;
    const parsed = (typeof marked !== 'undefined') ? marked.parse(newText) : escapeHtml(newText);
    el.querySelector('.msg-content').innerHTML = parsed;
    el.classList.remove('message-system');
    el.classList.add(senderClass || 'message-system');
}

async function fetchNextQuestion() {
    try {
        let questionData = {
            question: `Explain the core concepts of ${currentTopic} relevant to a ${currentRole} at a ${currentDifficulty} level.`,
            ideal_answer: 'Detailed comprehensive answer covering all technical keywords and semantic context.'
        };

        try {
            const askedQuestions = interviewHistory.map(h => h.question);
            const res = await fetch(`${API_BASE_URL}/generate_question`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    role: currentRole,
                    topic: currentTopic,
                    difficulty: currentDifficulty,
                    history: askedQuestions
                })
            });
            if (res.ok) questionData = await res.json();
        } catch (e) {
            console.warn('Backend not detected. Using frontend simulation logic.');
            const fallbacks = [
                { q: 'What is object-oriented programming?', a: 'OOP is a paradigm based on concepts of objects containing data and methods.' },
                { q: 'Explain the concept of RESTful web services.', a: 'REST is an architectural style utilizing standard HTTP methods for web APIs.' },
                { q: 'How does a database transaction ensure integrity?', a: 'It uses ACID (Atomicity, Consistency, Isolation, Durability) properties.' },
                { q: `Provide an overview of ${currentTopic} architecture.`, a: `The architecture of ${currentTopic} focuses on scalable layers and data handling.` }
            ];
            const askedQuestions = interviewHistory.map(h => h.question);
            let pool = fallbacks.filter(f => !askedQuestions.includes(`[OFFLINE SIMULATION] ${f.q}`));
            if (pool.length === 0) pool = fallbacks;
            const choice = pool[Math.floor(Math.random() * pool.length)];
            questionData.question = `[OFFLINE SIMULATION] ${choice.q}`;
            questionData.ideal_answer = choice.a;
        }

        currentQuestion = questionData.question;
        currentIdealAnswer = questionData.ideal_answer;

        appendMessage(currentQuestion, 'ai');
        speakText(currentQuestion);

        questionStartTime = Date.now();
        if (timeInterval) clearInterval(timeInterval);
        timeInterval = setInterval(() => {
            const seconds = Math.floor((Date.now() - questionStartTime) / 1000);
            if (timeVal) timeVal.textContent = `${seconds}s`;
        }, 1000);

    } catch (err) {
        console.error(err);
        appendMessage('System Error: Could not generate question.', 'system');
    }
}

async function submitAnswer(userAnswer, typingId) {
    if (timeInterval) clearInterval(timeInterval);
    const timeTaken = Math.floor((Date.now() - questionStartTime) / 1000);

    try {
        let evalData = null;
        let nextDiff = currentDifficulty;

        try {
            const res = await fetch(`${API_BASE_URL}/evaluate_answer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    user_id: userId,
                    question: currentQuestion,
                    user_answer: userAnswer,
                    ideal_answer: currentIdealAnswer,
                    current_difficulty: currentDifficulty,
                    topic: currentTopic,
                    role: currentRole,
                    session_id: currentSessionId
                })
            });
            if (res.ok) {
                const data = await res.json();
                if (data.evaluation) {
                    const ev = data.evaluation;
                    const expl = ev.explanation || {};
                    evalData = {
                        score: (ev.final_score ?? 0) * 10,
                        semantic_match: ev.bert_score ?? ev.semantic_score ?? 0,
                        tfidf_match: ev.tfidf_score ?? 0,
                        llm_match: ev.llm_score ?? 0,
                        feedback: buildFeedbackText(expl, ev)
                    };
                    nextDiff = data.next_difficulty ?? ev.difficulty_level;
                }
            }
        } catch (e) {
            const lengthScore = Math.min(userAnswer.split(' ').length / 15 * 10, 10);
            const finalScore = Math.max(lengthScore - (Math.random() * 2), 3.0).toFixed(1);
            const rel = finalScore > 7 ? 'High' : (finalScore > 4 ? 'Medium' : 'Low');
            const depth = finalScore > 7 ? 'Detailed' : 'Surface-level';
            const feedbackSim = finalScore > 6 ? 'Good job identifying the key ideas.' : 'Needs more clarity and precise terms.';
            evalData = {
                score: finalScore,
                semantic_match: (finalScore / 10).toFixed(2),
                tfidf_match: (Math.max(finalScore - 1, 0) / 10).toFixed(2),
                llm_match: Math.min(1, Math.max(0, (finalScore / 10) - 0.05)).toFixed(2),
                feedback: `**Offline simulation** (backend unreachable).\n\n* Relevance: ${rel}\n* Depth: ${depth}\n* Improvements: ${feedbackSim}\n\n**Score:** ${finalScore}/10`
            };
            nextDiff = finalScore > 7 ? 'hard' : (finalScore < 4 ? 'easy' : 'medium');
        }

        if (!evalData) {
            updateMessage(typingId, 'Evaluation failed.', 'message-system');
            return;
        }

        updateMessage(typingId, 'Evaluation complete. See the live panel for details.', 'message-system');

        animateScore(evalData.score);
        const semPct = evalData.semantic_match * 100;
        const keyPct = evalData.tfidf_match * 100;
        const llmPct = (evalData.llm_match ?? 0) * 100;
        if (semanticBar) semanticBar.style.width = `${semPct}%`;
        if (semanticVal) semanticVal.textContent = `${semPct.toFixed(0)}%`;
        if (keywordBar) keywordBar.style.width = `${keyPct}%`;
        if (keywordVal) keywordVal.textContent = `${keyPct.toFixed(0)}%`;
        if (llmBar) llmBar.style.width = `${llmPct}%`;
        if (llmVal) llmVal.textContent = `${llmPct.toFixed(0)}%`;

        if (feedbackBox) {
            feedbackBox.classList.remove('empty');
            const parsed = (typeof marked !== 'undefined') ? marked.parse(evalData.feedback) : escapeHtml(evalData.feedback);
            feedbackBox.innerHTML = `${parsed}<div class="feedback-ideal"><strong>Ideal blueprint:</strong><br>${escapeHtml(currentIdealAnswer)}</div>`;
        }

        interviewHistory.push({
            question: currentQuestion,
            userAnswer: userAnswer,
            score: parseFloat(evalData.score),
            difficulty: currentDifficulty,
            timeTaken: timeTaken
        });

        if (currentDifficulty !== nextDiff) {
            currentDifficulty = nextDiff;
            updateBadge();
            appendMessage(`<em>Difficulty adapted to: ${nextDiff.toUpperCase()}</em>`, 'system');
        }

        setTimeout(() => {
            appendMessage('<i class="fa-solid fa-spinner fa-spin"></i> Preparing next question...', 'system');
            setTimeout(() => {
                const last = chatbox.lastElementChild;
                if (last) last.remove();
                fetchNextQuestion();
            }, 1500);
        }, 2000);

    } catch (err) {
        console.error(err);
        updateMessage(typingId, 'Evaluation failed due to network error.', 'message-system');
    }
}

function buildFeedbackText(expl, ev) {
    const pct = (v) => v === undefined || v === null ? 'N/A' : (v * 100).toFixed(0) + '%';
    const missing = (expl.missing_concepts && expl.missing_concepts.length) ? expl.missing_concepts.join(', ') : 'None';
    const improvements = (expl.improvement_suggestions && expl.improvement_suggestions.length) ? expl.improvement_suggestions.join(', ') : 'None';
    return `**Evaluation**\n\n* Concept coverage: **${pct(expl.concept_coverage)}**\n* Depth: **${pct(expl.depth)}**\n* Clarity: **${pct(expl.clarity)}**\n* LLM quality: **${pct(ev.llm_score)}**\n\n**Feedback**\n\n* Missing concepts: ${missing}\n* Improvements: ${improvements}`;
}

function animateScore(score) {
    const percentage = (score / 10) * 100;
    setTimeout(() => {
        if (scorePath) {
            scorePath.setAttribute('stroke-dasharray', `${percentage}, 100`);
            if (score >= 8) scorePath.setAttribute('stroke', 'var(--success)');
            else if (score >= 5) scorePath.setAttribute('stroke', 'var(--warning)');
            else scorePath.setAttribute('stroke', 'var(--danger)');
        }
        let start = 0;
        const end = parseFloat(score);
        const duration = 1000;
        const step = end / (duration / 16);
        const counter = setInterval(() => {
            start += step;
            if (start >= end) { start = end; clearInterval(counter); }
            if (scoreText) scoreText.textContent = start.toFixed(1);
        }, 16);
    }, 100);
}

// =====================================================
// Report
// =====================================================
function computeReportStats() {
    const total = interviewHistory.length;
    if (total === 0) {
        return { total: 0, avg: 0, max: 0, min: 0, totalTime: 0, trend: '—', trendClass: 'trend-flat', startDiff: '—', endDiff: '—', difficulties: [] };
    }
    const scores = interviewHistory.map(i => i.score);
    const avg = scores.reduce((a, b) => a + b, 0) / total;
    const max = Math.max(...scores);
    const min = Math.min(...scores);
    const totalTime = interviewHistory.reduce((s, i) => s + (i.timeTaken || 0), 0);
    const mid = Math.ceil(total / 2);
    const firstAvg = interviewHistory.slice(0, mid).reduce((s, i) => s + i.score, 0) / mid;
    const secondAvg = interviewHistory.slice(mid).reduce((s, i) => s + i.score, 0) / (total - mid || 1);
    let trend = 'Stable', trendClass = 'trend-flat';
    if (secondAvg > firstAvg + 0.5) { trend = 'Improving'; trendClass = 'trend-up'; }
    else if (secondAvg < firstAvg - 0.5) { trend = 'Declining'; trendClass = 'trend-down'; }
    const difficulties = interviewHistory.map(i => i.difficulty);
    return { total, avg, max, min, totalTime, trend, trendClass, startDiff: difficulties[0] || '—', endDiff: difficulties[difficulties.length - 1] || '—', difficulties };
}

function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function scoreClass(score) {
    if (score >= 7) return 'q-strong';
    if (score >= 4) return 'q-average';
    return 'q-needs-work';
}
function scoreLabel(score) {
    if (score >= 7) return 'Strong';
    if (score >= 4) return 'Average';
    return 'Needs work';
}

function generateReport() {
    const stats = computeReportStats();
    const avgScore = stats.avg.toFixed(2);
    const min = Math.floor(stats.totalTime / 60);
    const sec = stats.totalTime % 60;

    const finalScoreBadge = document.getElementById('finalScoreBadge');
    const totalQuestions = document.getElementById('totalQuestions');
    const highestScore = document.getElementById('highestScore');
    const lowestScore = document.getElementById('lowestScore');
    const totalTimeEl = document.getElementById('totalTime');
    const trendValue = document.getElementById('trendValue');
    const reportMeta = document.getElementById('reportMeta');
    const questionCount = document.getElementById('questionCount');
    const reportQuestionsList = document.getElementById('reportQuestionsList');
    const strongAreasList = document.getElementById('strongAreasList');
    const weakAreasList = document.getElementById('weakAreasList');
    const roadmapText = document.getElementById('roadmapText');

    if (finalScoreBadge) finalScoreBadge.textContent = stats.total === 0 ? '0.00 / 10' : `${avgScore} / 10`;
    if (totalQuestions) totalQuestions.textContent = stats.total;
    if (highestScore) highestScore.textContent = stats.max.toFixed(2);
    if (lowestScore) lowestScore.textContent = stats.min.toFixed(2);
    if (totalTimeEl) totalTimeEl.textContent = `${min}m ${sec}s`;
    if (trendValue) {
        const arrow = stats.trend === 'Improving' ? '📈' : stats.trend === 'Declining' ? '📉' : '➡️';
        trendValue.innerHTML = `<span class="${stats.trendClass}">${arrow} ${stats.trend}</span>`;
    }

    if (reportMeta) {
        if (stats.total === 0) {
            reportMeta.innerHTML = '<span class="report-meta-item">No questions answered in this session.</span>';
        } else {
            const diffPills = stats.difficulties
                .map(d => `<span class="report-meta-item">${escapeHtml(d)}</span>`)
                .join('');
            reportMeta.innerHTML = `
                <span class="report-meta-item">Difficulty: <strong>${escapeHtml(stats.startDiff)} → ${escapeHtml(stats.endDiff)}</strong></span>
                <div class="difficulty-progression">${diffPills}</div>
            `;
        }
    }

    if (strongAreasList) strongAreasList.innerHTML = '';
    if (weakAreasList) weakAreasList.innerHTML = '';

    if (stats.total === 0) {
        if (roadmapText) roadmapText.textContent = 'You ended the interview before answering any questions.';
        if (questionCount) questionCount.textContent = '';
        if (reportQuestionsList) reportQuestionsList.innerHTML = '<p class="session-empty">No questions were answered.</p>';
        return;
    }

    if (stats.avg >= 7) {
        strongAreasList.innerHTML += `<li>Excellent grasp of <strong>${escapeHtml(currentTopic)}</strong> concepts (avg ${avgScore}/10).</li>`;
        strongAreasList.innerHTML += `<li>Handled <strong>${escapeHtml(currentDifficulty)}</strong> level technical questions well.</li>`;
        if (stats.max >= 9) strongAreasList.innerHTML += `<li>Peak score of <strong>${stats.max.toFixed(2)}/10</strong> shows mastery potential.</li>`;
        weakAreasList.innerHTML += `<li>Minor semantic gaps in deeper architectural analogies.</li>`;
        if (roadmapText) roadmapText.textContent = `Stellar performance for the ${currentRole} role! Continue studying advanced ${currentTopic} implementation details.`;
    } else if (stats.avg >= 4) {
        strongAreasList.innerHTML += `<li>Basic functional understanding of <strong>${escapeHtml(currentTopic)}</strong> (avg ${avgScore}/10).</li>`;
        if (stats.max >= 6) strongAreasList.innerHTML += `<li>Reached a high of <strong>${stats.max.toFixed(2)}/10</strong> on at least one question.</li>`;
        weakAreasList.innerHTML += `<li>Lacks confident detail in technical definitions.</li>`;
        weakAreasList.innerHTML += `<li>Struggled slightly with strict terminology limits.</li>`;
        if (roadmapText) roadmapText.textContent = `Good effort, but you need to strengthen your core fundamentals in ${currentTopic}. Focus on reading standard documentation and practicing delivery out loud.`;
    } else {
        strongAreasList.innerHTML += `<li>Attempted fundamental <strong>${escapeHtml(currentTopic)}</strong> questions.</li>`;
        weakAreasList.innerHTML += `<li>Significant technical gaps in the requested domain (avg ${avgScore}/10).</li>`;
        weakAreasList.innerHTML += `<li>Lowest score <strong>${stats.min.toFixed(2)}/10</strong> indicates a specific area to revisit.</li>`;
        if (roadmapText) roadmapText.textContent = `Consider revisiting the foundational courses for ${currentTopic}. Before scheduling another interview, rigorously study the core definitions and logic.`;
    }

    if (questionCount) questionCount.textContent = `(${stats.total})`;
    if (reportQuestionsList) {
        reportQuestionsList.innerHTML = interviewHistory.map((item, idx) => {
            const cls = scoreClass(item.score);
            const label = scoreLabel(item.score);
            return `
                <div class="report-question-item ${cls}">
                    <div class="report-question-header">
                        <div class="q-tags">
                            <span class="q-tag q-num">Q${idx + 1}</span>
                            <span class="q-tag q-score-${cls.replace('q-', '')}">${label} · ${item.score.toFixed(2)}/10</span>
                            <span class="q-tag q-diff">${escapeHtml(item.difficulty)}</span>
                            <span class="q-tag q-time">${item.timeTaken || 0}s</span>
                        </div>
                    </div>
                    <p class="report-question-text">${escapeHtml(item.question)}</p>
                    <div class="report-question-answer">"${escapeHtml(item.userAnswer || '(no answer recorded)')}"</div>
                </div>
            `;
        }).join('');
    }
}

function buildReportHtml() {
    const stats = computeReportStats();
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const avgScore = stats.total === 0 ? '0.00' : stats.avg.toFixed(2);
    const min = Math.floor(stats.totalTime / 60);
    const sec = stats.totalTime % 60;
    const diffProgression = stats.difficulties
        .map(d => `<span style="display:inline-block;padding:2px 8px;background:#e8e0ff;color:#5b21b6;border-radius:8px;margin-right:4px;font-size:11px;">${escapeHtml(d)}</span>`)
        .join('');

    const questionsHtml = stats.total === 0
        ? '<p style="color:#666;font-style:italic;">No questions were answered during this session.</p>'
        : interviewHistory.map((item, idx) => {
            const cls = scoreClass(item.score);
            const label = scoreLabel(item.score);
            const color = item.score >= 7 ? '#16a34a' : item.score >= 4 ? '#ea580c' : '#dc2626';
            return `
                <div style="border:1px solid #e0e0e0;border-left:4px solid ${color};padding:14px;margin-bottom:12px;border-radius:4px;page-break-inside:avoid;background:#fafafa;">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;flex-wrap:wrap;gap:6px;">
                        <div>
                            <span style="background:#18181b;color:white;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:600;">Question ${idx + 1}</span>
                            <span style="background:${color};color:white;padding:3px 10px;border-radius:10px;font-size:11px;font-weight:600;margin-left:6px;">${label} · ${item.score.toFixed(2)}/10</span>
                        </div>
                        <div style="font-size:11px;color:#666;text-align:right;">
                            Difficulty: <strong>${escapeHtml(item.difficulty)}</strong> · Time: <strong>${item.timeTaken || 0}s</strong>
                        </div>
                    </div>
                    <p style="margin:8px 0 0 0;font-weight:600;color:#1a1a2e;line-height:1.5;font-size:14px;">Q: ${escapeHtml(item.question)}</p>
                    <div style="margin-top:8px;padding:10px 12px;background:white;border:1px solid #ececec;border-radius:4px;color:#555;line-height:1.5;font-size:13px;">
                        <strong style="color:#18181b;">Your answer:</strong> ${escapeHtml(item.userAnswer || '(no answer recorded)')}
                    </div>
                </div>
            `;
        }).join('');

    return `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#1a1a2e;background:#ffffff;padding:40px 50px;max-width:800px;box-sizing:border-box;">
            <div style="text-align:center;border-bottom:3px solid #18181b;padding-bottom:20px;margin-bottom:30px;">
                <h1 style="color:#18181b;margin:0;font-size:28px;">AI Mock Interview Report</h1>
                <p style="color:#666;margin:6px 0 0 0;font-size:13px;">Generated on ${escapeHtml(date)}</p>
            </div>
            <div style="margin-bottom:25px;">
                <h2 style="color:#18181b;font-size:18px;margin:0 0 10px 0;">Session Details</h2>
                <table style="width:100%;border-collapse:collapse;font-size:14px;">
                    <tr><td style="padding:4px 0;width:140px;color:#666;">Target Role:</td><td><strong>${escapeHtml(currentRole)}</strong></td></tr>
                    <tr><td style="padding:4px 0;color:#666;">Topic:</td><td><strong>${escapeHtml(currentTopic)}</strong></td></tr>
                    <tr><td style="padding:4px 0;color:#666;">User ID:</td><td style="font-family:monospace;font-size:12px;">${escapeHtml(userId)}</td></tr>
                </table>
            </div>
            <div style="background:#f4f4f5;border-left:4px solid #18181b;padding:18px 22px;margin-bottom:25px;border-radius:4px;">
                <h2 style="color:#18181b;font-size:18px;margin:0 0 12px 0;">Performance Summary</h2>
                <table style="width:100%;border-collapse:collapse;font-size:14px;">
                    <tr><td style="padding:5px 0;width:210px;">Final Score (avg):</td><td style="padding:5px 0;font-size:18px;color:#18181b;"><strong>${avgScore} / 10</strong></td></tr>
                    <tr><td style="padding:5px 0;">Questions Answered:</td><td style="padding:5px 0;">${stats.total}</td></tr>
                    <tr><td style="padding:5px 0;">Highest Question Score:</td><td style="padding:5px 0;">${stats.max.toFixed(2)} / 10</td></tr>
                    <tr><td style="padding:5px 0;">Lowest Question Score:</td><td style="padding:5px 0;">${stats.min.toFixed(2)} / 10</td></tr>
                    <tr><td style="padding:5px 0;">Total Time:</td><td style="padding:5px 0;">${min}m ${sec}s</td></tr>
                    <tr><td style="padding:5px 0;">Performance Trend:</td><td style="padding:5px 0;"><strong>${escapeHtml(stats.trend)}</strong></td></tr>
                    <tr><td style="padding:5px 0;vertical-align:top;">Difficulty Progression:</td><td style="padding:5px 0;">${escapeHtml(stats.startDiff)} → ${escapeHtml(stats.endDiff)}<div style="margin-top:6px;">${diffProgression}</div></td></tr>
                </table>
            </div>
            <div style="margin-bottom:25px;">
                <h2 style="color:#18181b;font-size:18px;margin:0 0 12px 0;">All Questions Asked (${stats.total})</h2>
                ${questionsHtml}
            </div>
            <div style="margin-top:30px;padding-top:15px;border-top:1px solid #e0e0e0;text-align:center;color:#999;font-size:11px;">
                <p>Generated by Interview.AI — AI-Powered Adaptive Mock Interview System</p>
            </div>
        </div>
    `;
}

function printReport() {
    const html = buildReportHtml();
    const styles = `body { margin: 0; } @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`;
    const w = window.open('', '_blank');
    if (!w) {
        alert('Popup blocked. Please allow popups for this site, then click "Download PDF" again.');
        return;
    }
    w.document.open();
    w.document.write(`<!DOCTYPE html><html><head><title>Interview Report</title><style>${styles}</style></head><body>${html}</body></html>`);
    w.document.close();
    setTimeout(() => {
        try { w.focus(); w.print(); } catch (e) { console.error('Print failed:', e); }
    }, 400);
}

function downloadReportPdf() {
    const reportHtml = buildReportHtml();
    const filename = `Interview_Report_${(currentRole || 'Session').replace(/[^a-zA-Z0-9]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;

    if (typeof html2pdf === 'undefined') {
        console.warn('html2pdf not loaded; falling back to print dialog.');
        printReport();
        return;
    }

    const tempDiv = document.createElement('div');
    tempDiv.style.position = 'fixed';
    tempDiv.style.left = '-9999px';
    tempDiv.style.top = '0';
    tempDiv.style.width = '800px';
    tempDiv.style.background = '#ffffff';
    tempDiv.innerHTML = reportHtml;
    document.body.appendChild(tempDiv);

    const opt = {
        margin: 0.5,
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', logging: false },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
    };

    let settled = false;
    const cleanup = () => {
        if (settled) return;
        settled = true;
        if (tempDiv.parentNode) tempDiv.parentNode.removeChild(tempDiv);
    };

    html2pdf().set(opt).from(tempDiv).save()
        .then(cleanup)
        .catch(err => {
            console.error('html2pdf failed, falling back to print dialog:', err);
            cleanup();
            printReport();
        });
}

// =====================================================
// Boot
// =====================================================
showView('setup');
loadSessions();
