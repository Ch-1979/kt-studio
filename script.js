// Storyboard playback configuration
// Single video mode: no storyboard scene stepping
const SCENE_DURATION_SECONDS = 8; // retained for fallback timing only

// Global state management
let appState = {
    isFileUploaded: false,
    isVideoReady: false,
    isVideoPlaying: false,
    isQuizActive: false,
    currentProgress: 0,
    selectedFileName: '',
    currentSceneIndex: 0,
    totalDurationSeconds: 0
};

let videoScenes = []; // normalized scenes currently loaded into the player
let playbackInterval = null; // interval handle for autoplay
let videoAsset = null; // current generated video asset (Sora output)
let videoListenersAttached = false;

// DOM elements
const elements = {
    // Upload section
    ktDocumentInput: document.getElementById('ktDocumentInput'),
    uploadButton: document.getElementById('uploadButton'),
    uploadStatus: document.getElementById('uploadStatus'),
    
    // Processing section
    videoStatus: document.getElementById('videoStatus'),
    videoReadySection: document.getElementById('videoReadySection'),
    watchVideoButton: document.getElementById('watchVideoButton'),
    fileDisplaySection: document.getElementById('fileDisplaySection'),
    fileNameDisplay: document.getElementById('fileNameDisplay'),
    takeQuizButton: document.getElementById('takeQuizButton'),
    
    // Video player
    videoTitle: document.getElementById('videoTitle'),
    sceneBackdrop: document.getElementById('sceneBackdrop'),
    sceneBadge: document.getElementById('sceneBadge'),
    sceneTitle: document.getElementById('sceneTitle'),
    sceneText: document.getElementById('sceneText'),
    sceneKeywords: document.getElementById('sceneKeywords'),
    progressBar: document.getElementById('progressBar'),
    playPauseButton: document.getElementById('playPauseButton'),
    currentTime: document.getElementById('currentTime'),
    totalTime: document.getElementById('totalTime'),
    // Removed scene navigation & indicators
    storyboardVideo: document.getElementById('storyboardVideo'),
    videoControls: document.querySelector('.video-controls'),
    videoDiagnosticsPanel: document.getElementById('videoDiagnosticsPanel'),
    videoDiagStatus: document.getElementById('videoDiagStatus'),
    videoDiagContentType: document.getElementById('videoDiagContentType'),
    videoDiagBytes: document.getElementById('videoDiagBytes'),
    videoDiagFourcc: document.getElementById('videoDiagFourcc'),
    videoDiagMajor: document.getElementById('videoDiagMajor'),
    videoDiagEvents: document.getElementById('videoDiagEvents'),
    videoDiagDetails: document.getElementById('videoDiagDetails'),
    openVideoButton: document.getElementById('openVideoButton'),
    copyVideoUrlButton: document.getElementById('copyVideoUrlButton'),
    
    // Quiz section
    quizQuestions: document.getElementById('quizQuestions'),
    activeQuiz: document.getElementById('activeQuiz'),
    submitQuizButton: document.getElementById('submitQuizButton'),
    quizResult: document.getElementById('quizResult'),

    // Chatbot
    chatMessages: document.getElementById('chatMessages'),
    chatInput: document.getElementById('chatInput'),
    chatForm: document.getElementById('chatForm'),
    chatStatus: document.getElementById('chatStatus'),
    chatDocSelect: document.getElementById('chatDocSelect'),
    chatRefreshButton: document.getElementById('chatRefreshButton')
};

// Newly added elements for processed documents
const processedElements = {
    select: document.getElementById('processedDocsSelect'),
    refreshButton: document.getElementById('refreshDocsButton'),
    loadButton: document.getElementById('loadProcessedButton'),
    hint: document.getElementById('processedDocsHint')
};

let loadedVideoData = null; // stores currently loaded generated video JSON
let loadedQuizData = null;  // stores currently loaded generated quiz JSON
const videoEventLog = [];
const chatState = {
    history: [],
    selectedDoc: '',
    isLoading: false
};

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    initializeEventListeners();
    initializeChatbot();
    updateUI();
    renderVideoEventLog();
    updateVideoDiagnostics();
});

// Event Listeners
function initializeEventListeners() {
    // Upload functionality
    elements.uploadButton.addEventListener('click', handleUploadClick);
    elements.ktDocumentInput.addEventListener('change', handleFileSelection);
    
    // Video functionality
    elements.watchVideoButton.addEventListener('click', handleWatchVideo);
    elements.playPauseButton.addEventListener('click', handlePlayPause);
    elements.progressBar.addEventListener('input', handleProgressChange);
    // Scene navigation removed in single-video mode
    
    // Quiz functionality
    elements.takeQuizButton.addEventListener('click', handleTakeQuiz);
    elements.submitQuizButton.addEventListener('click', handleSubmitQuiz);

    if (elements.openVideoButton) elements.openVideoButton.addEventListener('click', handleOpenVideo);
    if (elements.copyVideoUrlButton) elements.copyVideoUrlButton.addEventListener('click', handleCopyVideoUrl);

    // Processed docs actions
    if (processedElements.refreshButton) processedElements.refreshButton.addEventListener('click', fetchProcessedDocs);
    if (processedElements.loadButton) processedElements.loadButton.addEventListener('click', loadSelectedProcessedDoc);
    
    // Quiz option selection
    document.addEventListener('change', function(e) {
        if (e.target.type === 'radio' && e.target.name === 'q1') {
            handleQuizOptionSelection(e.target.value);
        }
    });

    // Chatbot interactions
    if (elements.chatForm) elements.chatForm.addEventListener('submit', handleChatSubmit);
    if (elements.chatRefreshButton) elements.chatRefreshButton.addEventListener('click', handleChatRefresh);
    if (elements.chatDocSelect) elements.chatDocSelect.addEventListener('change', handleChatDocChange);
}

// Upload functionality
function handleUploadClick() {
    elements.ktDocumentInput.click();
}

async function handleFileSelection(event) {
    const file = event.target.files[0];
    if (!file) return;
    appState.selectedFileName = file.name;
    elements.uploadStatus.textContent = `Uploading: ${file.name} ...`;
    elements.uploadStatus.style.display = 'block';
    elements.uploadStatus.classList.add('fade-in');
    elements.videoStatus.textContent = 'Status: Uploading...';
    try {
        const arrayBuffer = await file.arrayBuffer();
        const base = window.location.origin;
        const resp = await fetch(`${base}/api/upload?name=${encodeURIComponent(file.name)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: arrayBuffer
        });
        if (!resp.ok) throw new Error(`Upload failed HTTP ${resp.status}`);
        const meta = await resp.json();
        elements.uploadStatus.textContent = `Uploaded ${meta.fileName} (${meta.uploadedBytes} bytes)`;
        appState.isFileUploaded = true;
        elements.videoStatus.textContent = 'Status: Waiting for processing...';
        pollProcessingStatus(meta.docName);
    } catch (e) {
        console.error('Upload failed', e);
        elements.uploadStatus.textContent = 'Upload failed: ' + e.message;
        elements.videoStatus.textContent = 'Status: Upload error';
    }
    updateUI();
}

async function pollProcessingStatus(docBase) {
    let attempts = 0;
    const maxAttempts = 40; // ~4 minutes at 6s interval
    const base = window.location.origin;
    async function tick() {
        attempts++;
        try {
            const resp = await fetch(`${base}/api/status/${encodeURIComponent(docBase)}`);
            if (resp.ok) {
                const st = await resp.json();
                if (st.ready) {
                    elements.videoStatus.textContent = 'Status: Ready (processed)';
                    appState.isVideoReady = true;
                    elements.fileNameDisplay.textContent = docBase + '.txt';
                    // Preload content
                    await Promise.all([
                        fetchGeneratedVideo(docBase),
                        fetchGeneratedQuiz(docBase)
                    ]);
                    if (loadedVideoData) applyLoadedVideo(docBase, loadedVideoData);
                    return;
                } else {
                    const parts = [];
                    parts.push(st.video ? 'video ✅' : 'video …');
                    parts.push(st.quiz ? 'quiz ✅' : 'quiz …');
                    elements.videoStatus.textContent = 'Status: Processing... (' + parts.join(', ') + ')';
                }
            } else {
                elements.videoStatus.textContent = 'Status: Checking...';
            }
        } catch (e) {
            elements.videoStatus.textContent = 'Status: Waiting...';
        }
        if (attempts < maxAttempts && !appState.isVideoReady) {
            setTimeout(tick, 6000);
        } else if (!appState.isVideoReady) {
            elements.videoStatus.textContent = 'Status: Timed out waiting for processing';
        }
    }
    setTimeout(tick, 5000); // initial delay to allow trigger start
}

// Video functionality
function handleWatchVideo() {
    if (!videoScenes.length && loadedVideoData?.scenes) {
        hydrateStoryboardFromJson(loadedVideoData);
    }
    updateVideoPlayer();

    if (videoAsset?.mp4Url && elements.storyboardVideo) {
        elements.storyboardVideo.play().catch(() => {/* ignore autoplay block */});
    }

    setTimeout(() => {
        elements.takeQuizButton.style.display = 'block';
        elements.takeQuizButton.classList.add('fade-in');
    }, 600);
    updateVideoDiagnostics({ reason: 'watchVideo' });
}

function handlePlayPause() {
    if (videoAsset?.mp4Url && elements.storyboardVideo) {
        const videoEl = elements.storyboardVideo;
        if (videoEl.ended) {
            videoEl.currentTime = 0;
        }
        if (videoEl.paused) {
            videoEl.play().catch(() => {});
        } else {
            videoEl.pause();
        }
        return;
    }
    // If no generated video yet, nothing else to toggle.
}

function startPlayback() { /* no-op in single video mode without asset */ }

function pausePlayback(options = {}) {
    const { reachedEnd = false } = options;
    if (videoAsset?.mp4Url && elements.storyboardVideo) {
        const videoEl = elements.storyboardVideo;
        videoEl.pause();
        if (reachedEnd) {
            if (Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
                videoEl.currentTime = videoEl.duration;
            }
            appState.currentProgress = 100;
            elements.playPauseButton.innerHTML = '<i class="fas fa-rotate-right"></i>';
        } else {
            elements.playPauseButton.innerHTML = '<i class="fas fa-play"></i>';
        }
        appState.isVideoPlaying = false;
        updateTimeDisplay();
        return;
    }
    if (playbackInterval) {
        clearInterval(playbackInterval);
        playbackInterval = null;
    }
    appState.isVideoPlaying = false;
    elements.playPauseButton.innerHTML = reachedEnd ? '<i class="fas fa-rotate-right"></i>' : '<i class="fas fa-play"></i>';
}

function handleProgressChange(event) {
    if (!videoScenes.length) return;
    const value = parseInt(event.target.value, 10);
    if (videoAsset?.mp4Url && elements.storyboardVideo) {
        const videoEl = elements.storyboardVideo;
        const duration = Number(videoEl.duration) || videoAsset.durationSeconds || (videoScenes.length * SCENE_DURATION_SECONDS);
        if (Number.isFinite(duration) && duration > 0) {
            const targetTime = Math.min(100, Math.max(0, value)) / 100 * duration;
            videoEl.currentTime = targetTime;
        }
        appState.currentProgress = Math.min(100, Math.max(0, value));
        updateTimeDisplay();
        return;
    }
    // No scene model fallback UI now
}

function handleOpenVideo() {
    if (!videoAsset?.mp4Url) {
        showNotification('No generated video URL yet.', 'error');
        return;
    }
    window.open(videoAsset.mp4Url, '_blank', 'noopener');
    logVideoEvent('openVideo');
}

async function handleCopyVideoUrl() {
    if (!videoAsset?.mp4Url) {
        showNotification('No generated video URL yet.', 'error');
        return;
    }
    try {
        await navigator.clipboard.writeText(videoAsset.mp4Url);
        showNotification('Video URL copied to clipboard.', 'success');
        logVideoEvent('copyVideoUrl');
    } catch (err) {
        console.warn('[video-diagnostics] Failed to copy URL', err);
        showNotification('Unable to copy video URL. Check browser permissions.', 'error');
    }
}

function describeReadyState(code) {
    switch (code) {
        case 0: return 'HAVE_NOTHING';
        case 1: return 'HAVE_METADATA';
        case 2: return 'HAVE_CURRENT_DATA';
        case 3: return 'HAVE_FUTURE_DATA';
        case 4: return 'HAVE_ENOUGH_DATA';
        default: return `STATE_${code}`;
    }
}

function describeNetworkState(code) {
    switch (code) {
        case 0: return 'NETWORK_EMPTY';
        case 1: return 'NETWORK_IDLE';
        case 2: return 'NETWORK_LOADING';
        case 3: return 'NETWORK_NO_SOURCE';
        default: return `NETWORK_${code}`;
    }
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return 'unknown';
    const units = ['B', 'KB', 'MB', 'GB'];
    const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    const value = bytes / Math.pow(1024, idx);
    return `${value.toFixed(value > 100 ? 0 : 1)} ${units[idx]}`;
}

function logVideoEvent(type, details = {}) {
    const videoEl = elements.storyboardVideo;
    const now = Date.now();
    if (type === 'timeupdate' || type === 'progress') {
        const last = videoEventLog[videoEventLog.length - 1];
        if (last && last.type === 'timeupdate' && now - last.epoch < 750) {
            return;
        }
        if (last && last.type === 'progress' && now - last.epoch < 750) {
            return;
        }
    }
    const entry = {
        epoch: now,
        label: new Date(now).toLocaleTimeString(),
        type,
        current: videoEl ? Number(videoEl.currentTime.toFixed(2)) : null,
        readyState: videoEl ? describeReadyState(videoEl.readyState) : 'n/a',
        networkState: videoEl ? describeNetworkState(videoEl.networkState) : 'n/a',
        detail: details.message || details.note || ''
    };
    videoEventLog.push(entry);
    if (videoEventLog.length > 40) {
        videoEventLog.shift();
    }
    renderVideoEventLog();
}

function renderVideoEventLog() {
    const list = elements.videoDiagEvents;
    if (!list) return;
    list.innerHTML = '';
    if (!videoEventLog.length) {
        const li = document.createElement('li');
        li.textContent = 'Waiting for playback events...';
        list.appendChild(li);
        return;
    }
    [...videoEventLog]
        .slice()
        .reverse()
        .forEach(evt => {
            const li = document.createElement('li');
            const timeText = typeof evt.current === 'number' ? `${evt.current.toFixed(1)}s` : 'n/a';
            const detail = evt.detail ? ` • ${evt.detail}` : '';
            li.textContent = `[${evt.label}] ${evt.type} • t=${timeText} • ready=${evt.readyState} • net=${evt.networkState}${detail}`;
            list.appendChild(li);
        });
}

function updateVideoDiagnostics({ reason } = {}) {
    const panel = elements.videoDiagnosticsPanel;
    if (!panel) return;
    const videoEl = elements.storyboardVideo;

    if (videoAsset?.mp4Url) {
        panel.classList.add('active');
        const ready = videoEl ? describeReadyState(videoEl.readyState) : 'n/a';
        const network = videoEl ? describeNetworkState(videoEl.networkState) : 'n/a';
        elements.videoDiagStatus.textContent = `Ready (${ready} | ${network})`;
        elements.videoDiagContentType.textContent = videoAsset.contentType || 'unknown';
        elements.videoDiagBytes.textContent = videoAsset.byteLength ? formatBytes(videoAsset.byteLength) : 'unknown';
        elements.videoDiagFourcc.textContent = videoAsset.containerFourCc || '—';
        elements.videoDiagMajor.textContent = videoAsset.majorBrand || '—';
    } else {
        panel.classList.remove('active');
        elements.videoDiagStatus.textContent = 'No video asset loaded';
        elements.videoDiagContentType.textContent = '—';
        elements.videoDiagBytes.textContent = '—';
        elements.videoDiagFourcc.textContent = '—';
        elements.videoDiagMajor.textContent = '—';
        videoEventLog.length = 0;
        renderVideoEventLog();
    }

    if (reason) {
        logVideoEvent(reason);
    }
}

function jumpScene() { /* removed */ }

function updateTimeDisplay() {
    if (videoAsset?.mp4Url && elements.storyboardVideo) {
        const videoEl = elements.storyboardVideo;
        const duration = Number(videoEl.duration) || videoAsset.durationSeconds || (videoScenes.length * SCENE_DURATION_SECONDS);
        const currentSeconds = Number.isFinite(videoEl.currentTime) ? videoEl.currentTime : (appState.currentProgress / 100) * duration;
        elements.currentTime.textContent = formatTime(currentSeconds);
        elements.totalTime.textContent = formatTime(duration);
        return;
    }
    const total = Math.max(appState.totalDurationSeconds, videoScenes.length * SCENE_DURATION_SECONDS);
    const currentSeconds = Math.round((appState.currentProgress / 100) * total);
    elements.currentTime.textContent = formatTime(currentSeconds);
    elements.totalTime.textContent = formatTime(total);
}

function updateVideoPlayer() {
    if (appState.selectedFileName) {
        elements.videoTitle.textContent = `Project: ${toTitleCase(extractDocBase(appState.selectedFileName))}`;
    }
    if (videoAsset?.mp4Url) {
        syncVideoProgressFromElement();
    } else {
        elements.progressBar.value = Math.round(appState.currentProgress);
        updateTimeDisplay();
    }
    updateVideoDiagnostics();
}

// Quiz functionality
function handleTakeQuiz() {
    appState.isQuizActive = true;
    updateUI();

    // Attempt to fetch quiz dynamically from backend API (Azure Functions)
    if (loadedQuizData && loadedQuizData.questions) {
        renderQuiz(loadedQuizData.questions);
    } else {
        fetchQuizData();
    }

    // Scroll to quiz section
    document.querySelector('.quiz-card').scrollIntoView({
        behavior: 'smooth',
        block: 'center'
    });
}

function handleQuizOptionSelection(value) {
    elements.submitQuizButton.style.display = 'block';
    elements.submitQuizButton.classList.add('fade-in');
}

function handleSubmitQuiz() {
    const activeQuizContainer = document.getElementById('activeQuiz');
    const questionBlocks = activeQuizContainer.querySelectorAll('[data-question-id]');
    if (!questionBlocks.length) {
        showQuizResult('Quiz not loaded.', 'incorrect');
        return;
    }

    let allAnswered = true;
    let allCorrect = true;
    questionBlocks.forEach(block => {
        const qid = block.getAttribute('data-question-id');
        const selected = block.querySelector('input[type="radio"]:checked');
        if (!selected) {
            allAnswered = false;
            return;
        }
        const correct = selected.dataset.correct === 'true';
        if (!correct) {
            allCorrect = false;
        }
        // Lock options
        block.querySelectorAll('input[type="radio"]').forEach(r => r.disabled = true);
    });

    if (!allAnswered) {
        showQuizResult('Please answer all questions.', 'incorrect');
        return;
    }

    if (allCorrect) {
        showQuizResult('Great job! All answers are correct.', 'correct');
    } else {
        showQuizResult('Some answers are incorrect. Review the material and try again.', 'incorrect');
    }

    elements.submitQuizButton.style.display = 'none';
}

function showQuizResult(message, type) {
    elements.quizResult.textContent = message;
    elements.quizResult.className = `quiz-result ${type}`;
    elements.quizResult.style.display = 'block';
    elements.quizResult.classList.add('fade-in');
}

// Fetch quiz data from API (with graceful fallback if unavailable)
async function fetchQuizData() {
    const intro = document.querySelector('.quiz-intro');
    if (intro) intro.style.display = 'none';

    elements.activeQuiz.style.display = 'block';
    elements.activeQuiz.classList.add('fade-in');
    elements.activeQuiz.innerHTML = '<p style="font-size:14px;color:#666;">Loading quiz...</p>';

    // Determine base URL (deployed vs local static server)
    const base = window.location.origin;
    const apiUrl = `${base}/api/quiz/sample`;

    try {
        const resp = await fetch(apiUrl, { method: 'GET', headers: { 'Accept': 'application/json' } });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json().catch(() => { throw new Error('Invalid JSON'); });
        if (!data.questions || !Array.isArray(data.questions)) throw new Error('Malformed payload');
        renderQuiz(data.questions);
    } catch (err) {
        console.warn('Quiz API fetch failed, falling back to static quiz. Reason:', err.message);
        renderQuiz([
            {
                id: 'q1',
                text: "What is the primary database used in Project Alpha's architecture?",
                options: ["MySQL", "PostgreSQL", "Cosmos DB", "MongoDB"],
                correctIndex: 1
            }
        ]);
    }
}

// ---------------- Processed Docs Integration ---------------- //
async function fetchProcessedDocs() {
    const base = window.location.origin;
    const url = `${base}/api/list/docs`;
    if (processedElements.refreshButton) processedElements.refreshButton.disabled = true;
    if (elements.chatRefreshButton) elements.chatRefreshButton.disabled = true;
    try {
        const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const docs = Array.isArray(data.documents) ? data.documents : [];
        populateProcessedDocsSelect(docs);
        updateChatDocOptions(docs);
        showNotification(`Loaded ${docs.length} processed docs`, 'success');
    } catch (e) {
        console.warn('Failed to fetch processed docs', e);
        showNotification('Failed to load documents', 'error');
    } finally {
        if (processedElements.refreshButton) processedElements.refreshButton.disabled = false;
        if (elements.chatRefreshButton) elements.chatRefreshButton.disabled = false;
    }
}

function populateProcessedDocsSelect(docs) {
    const sel = processedElements.select;
    sel.innerHTML = '';
    if (!docs.length) {
        sel.innerHTML = '<option value="" disabled selected>-- none found --</option>';
        return;
    }
    sel.innerHTML = '<option value="" disabled selected>Select document...</option>' +
        docs.map(d => `<option value="${d}">${d}</option>`).join('');
}

function updateChatDocOptions(docs) {
    const select = elements.chatDocSelect;
    if (!select) return;

    const previous = select.value;
    select.innerHTML = '<option value="" disabled selected>-- select document --</option>' +
        docs.map(d => `<option value="${d}">${d}</option>`).join('');

    if (previous && docs.includes(previous)) {
        select.value = previous;
        chatState.selectedDoc = previous;
    } else {
        chatState.selectedDoc = '';
        renderChatEmptyState();
    }
}

// ---------------- Chatbot Experience ---------------- //

function initializeChatbot() {
    renderChatEmptyState();
    setChatStatus('Select a processed document to begin.');
    if (elements.chatInput) elements.chatInput.disabled = true;
}

function renderChatEmptyState(message) {
    if (!elements.chatMessages) return;
    const text = message || 'Choose a document and ask a question to get started.';
    elements.chatMessages.innerHTML = `<div class="chat-empty-state">${text}</div>`;
}

function handleChatDocChange() {
    if (!elements.chatDocSelect) return;
    const value = elements.chatDocSelect.value;
    chatState.selectedDoc = value;
    chatState.history = [];
    renderChatEmptyState(`Chatting about <strong>${escapeHtml(value)}</strong>. Ask your first question!`);
    setChatStatus('');
    if (elements.chatInput) {
        elements.chatInput.disabled = false;
        elements.chatInput.focus();
    }
}

function handleChatRefresh(event) {
    if (event) event.preventDefault();
    fetchProcessedDocs();
}

function handleChatSubmit(event) {
    event.preventDefault();
    if (chatState.isLoading) return;
    if (!chatState.selectedDoc) {
        setChatStatus('Please select a document first.');
        return;
    }
    const question = elements.chatInput.value.trim();
    if (!question) return;

    appendChatMessage('user', question);
    chatState.history.push({ role: 'user', content: question });
    elements.chatInput.value = '';
    sendChatMessage(question);
}

async function sendChatMessage(question) {
    const historyPayload = chatState.history.slice(-10);
    chatState.isLoading = true;
    setChatStatus('Thinking...');
    if (elements.chatInput) elements.chatInput.disabled = true;
    const base = window.location.origin;
    try {
        const resp = await fetch(`${base}/api/chatbot/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                docName: chatState.selectedDoc,
                question,
                history: historyPayload
            })
        });

        const rawBody = await resp.text();
        let data = null;
        if (rawBody) {
            try {
                data = JSON.parse(rawBody);
            } catch (parseErr) {
                console.warn('[chatbot] Non-JSON response payload', { status: resp.status, body: rawBody, error: parseErr });
            }
        }

        if (!resp.ok) {
            const message = (data && data.error) ? data.error : (rawBody || `HTTP ${resp.status}`);
            const detailSource = data && (data.details || data.trace || data.response);
            const detailText = detailSource ? ` ${formatErrorDetails(detailSource)}` : '';
            appendChatMessage('bot', `I hit a snag answering that: ${message}${detailText}`);
            setChatStatus('');
            chatState.isLoading = false;
            if (elements.chatInput) elements.chatInput.disabled = false;
            return;
        }

        const answer = (data && data.answer) ? data.answer : 'I was unable to find relevant information in the document.';
        appendChatMessage('bot', answer, { subtitle: `Source: ${chatState.selectedDoc}` });
        chatState.history.push({ role: 'assistant', content: answer });
        setChatStatus('');
    } catch (err) {
        appendChatMessage('bot', `I could not reach the Q&A service. ${err.message || err}`);
        setChatStatus('');
    } finally {
        chatState.isLoading = false;
        if (elements.chatInput) elements.chatInput.disabled = false;
        if (elements.chatInput) elements.chatInput.focus();
    }
}

function appendChatMessage(role, text, options = {}) {
    if (!elements.chatMessages || !text) return;

    if (elements.chatMessages.querySelector('.chat-empty-state')) {
        elements.chatMessages.innerHTML = '';
    }

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;

    const safeText = escapeHtml(text).replace(/\n/g, '<br>');
    bubble.innerHTML = safeText;

    if (options.subtitle) {
        const small = document.createElement('small');
        small.innerText = options.subtitle;
        bubble.appendChild(small);
    }

    elements.chatMessages.appendChild(bubble);
    scrollChatToBottom();
}

function setChatStatus(message) {
    if (!elements.chatStatus) return;
    elements.chatStatus.textContent = message || '';
}

function scrollChatToBottom() {
    if (!elements.chatMessages) return;
    requestAnimationFrame(() => {
        elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
    });
}

function escapeHtml(str) {
    return str.replace(/[&<>"']/g, function(match) {
        switch (match) {
            case '&': return '&amp;';
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '"': return '&quot;';
            case "'": return '&#39;';
            default: return match;
        }
    });
}

function formatErrorDetails(details) {
    if (!details) return '';
    try {
        if (typeof details === 'string') {
            return `(${details})`;
        }
        return `(${JSON.stringify(details)})`;
    } catch (err) {
        return '';
    }
}

async function loadSelectedProcessedDoc() {
    const doc = processedElements.select.value;
    if (!doc) {
        showNotification('Choose a document first', 'error');
        return;
    }
    await Promise.all([
        fetchGeneratedVideo(doc),
        fetchGeneratedQuiz(doc)
    ]);
    if (loadedVideoData) {
        applyLoadedVideo(doc, loadedVideoData);
        showNotification('Video script loaded', 'success');
    }
}

async function fetchGeneratedVideo(docName) {
    loadedVideoData = null;
    const base = window.location.origin;
    try {
        // Add cache-busting param to avoid stale 304 returning an old stub
        const resp = await fetch(`${base}/api/video/${encodeURIComponent(docName)}?t=${Date.now()}`, { headers: { 'Accept': 'application/json', 'Cache-Control': 'no-cache' } });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        loadedVideoData = await resp.json();
        console.debug('[video-diagnostics] Raw video JSON payload:', loadedVideoData);
    } catch (e) {
        console.warn('Video fetch failed', e);
        showNotification('Video data not found', 'error');
    }
}

async function fetchGeneratedQuiz(docName) {
    loadedQuizData = null;
    const base = window.location.origin;
    try {
        const resp = await fetch(`${base}/api/quiz/${encodeURIComponent(docName)}`, { headers: { 'Accept': 'application/json' } });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        // map expected shape to existing quiz renderer
        if (Array.isArray(data.questions)) {
            loadedQuizData = data;
        } else if (Array.isArray(data.quiz)) {
            loadedQuizData = { questions: data.quiz };
        }
    } catch (e) {
        console.warn('Quiz fetch failed', e);
    }
}

function applyLoadedVideo(docName, videoJson) {
    appState.selectedFileName = docName + '.txt';
    appState.isFileUploaded = true;
    appState.isVideoReady = true;
    elements.videoStatus.textContent = 'Status: Ready (loaded)';
    elements.fileNameDisplay.textContent = docName + '.txt';
    hydrateStoryboardFromJson(videoJson);
    updateUI();
    if (loadedQuizData && loadedQuizData.questions) {
        elements.takeQuizButton.style.display = 'block';
    }
    updateVideoDiagnostics({ reason: 'manifestLoaded' });
}

function hydrateStoryboardFromJson(videoJson) {
    const rawScenes = Array.isArray(videoJson?.scenes) ? videoJson.scenes : [];
    const normalized = normalizeScenes(rawScenes, videoJson?.summary);
    videoScenes = normalized.length ? normalized : [
        buildSceneFromText(videoJson?.summary || 'This document did not include scene details, so this is a generated overview.', 0)
    ];

    const asset = normalizeVideoAsset(videoJson?.videoAsset);
    configureVideoAsset(asset);

    if (videoJson?.videoAsset) {
        const status = videoJson.videoAsset.status || videoJson.videoAsset.Status;
        const errorMessage = videoJson.videoAsset.error || videoJson.videoAsset.Error;
        if (status === 'failed' && errorMessage) {
            showNotification('Video generation failed: ' + errorMessage, 'error');
        } else if (status === 'skipped' && errorMessage) {
            showNotification('Video generation skipped: ' + errorMessage, 'info');
        }
    }

    appState.currentSceneIndex = 0;
    appState.currentProgress = 0;
    appState.totalDurationSeconds = videoAsset?.durationSeconds || (videoScenes.length * SCENE_DURATION_SECONDS);

    // Single-video mode: no scene indicators; initialize keywords & text using first entry
    if (videoScenes.length) {
        const first = videoScenes[0];
        elements.sceneTitle.textContent = first.title;
        elements.sceneText.textContent = first.text;
        renderSceneKeywords(first.keywords || []);
        elements.sceneBadge.textContent = first.badge || '';
        elements.sceneBadge.classList.toggle('hidden', !first.badge);
    }
    // Reset progress bar visual
    elements.progressBar.value = 0;
    updateTimeDisplay();
}

function normalizeScenes(rawScenes, fallbackSummary) {
    if (!Array.isArray(rawScenes)) return [];
    return rawScenes
        .map((scene, idx) => {
            if (typeof scene === 'string') {
                return buildSceneFromText(scene, idx);
            }
            const text = scene.text || scene.narration || scene.caption || scene.content || fallbackSummary || '';
            if (!text || !text.trim()) return null;
            const title = scene.title || createTitleFromText(text, idx);
            const rawKeywords = Array.isArray(scene.keywords) && scene.keywords.length
                ? scene.keywords
                : guessKeywords(text);
            const keywords = Array.from(new Set(rawKeywords.map(k => (k || '').toString().trim()).filter(Boolean)));
            return {
                index: scene.index ?? idx + 1,
                title,
                text,
                keywords,
                badge: scene.badge || null,
                imageUrl: scene.imageUrl || scene.image_url || null,
                imageAlt: scene.imageAlt || scene.image_alt || title,
                visualPrompt: scene.visualPrompt || null,
                gradient: scene.gradient || createGradient(idx),
                mood: scene.mood || null
            };
        })
        .filter(Boolean);
}

function normalizeVideoAsset(raw) {
    if (!raw || !raw.mp4Url) return null;
    const duration = Number(raw.durationSeconds);
    console.debug('[video-diagnostics] Normalizing video asset', raw);
    return {
        mp4Url: raw.mp4Url,
        thumbnailUrl: raw.thumbnailUrl || null,
        durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : 0,
        prompt: raw.prompt || '',
        operationId: raw.operationId || raw.id || null,
        sourceUrl: raw.sourceUrl || null,
        thumbnailSourceUrl: raw.thumbnailSourceUrl || null,
        contentType: raw.contentType || null,
        byteLength: (() => {
            const value = typeof raw.byteLength === 'string' ? Number.parseFloat(raw.byteLength) : raw.byteLength;
            return Number.isFinite(value) && value > 0 ? value : null;
        })(),
        containerFourCc: raw.containerFourCc || raw.header || null,
        majorBrand: raw.majorBrand || null,
        hexPrefix: raw.hexPrefix || null
    };
}

function configureVideoAsset(asset) {
    const videoEl = elements.storyboardVideo;
    if (!videoEl) return;

    if (asset && asset.mp4Url) {
        console.debug('[video-diagnostics] Configuring video element with mp4Url:', asset.mp4Url);
        videoAsset = asset;
        videoEl.src = asset.mp4Url;
        videoEl.classList.add('active');
        videoEl.setAttribute('controls', 'controls');
        videoEl.playsInline = true;
        videoEl.loop = false;
        videoEl.muted = false;
        if (asset.thumbnailUrl) {
            videoEl.poster = asset.thumbnailUrl;
        } else if (asset.thumbnailSourceUrl) {
            videoEl.poster = asset.thumbnailSourceUrl;
        } else if (videoScenes[0]?.imageUrl) {
            videoEl.poster = videoScenes[0].imageUrl;
        } else {
            videoEl.removeAttribute('poster');
        }
        videoEl.load();
        if (!videoListenersAttached) {
            attachVideoEventListeners();
        }
        if (asset.durationSeconds) {
            appState.totalDurationSeconds = asset.durationSeconds;
        }
        if (elements.sceneBackdrop) {
            elements.sceneBackdrop.classList.add('has-video');
        }
        updateTimeDisplay();
        if (asset.containerFourCc && asset.containerFourCc.toLowerCase() !== 'ftyp') {
            showNotification(`Video header ${asset.containerFourCc} detected; playback support may vary.`, 'info');
            console.warn('[video-diagnostics] Unexpected container header', asset.containerFourCc, asset);
        }
        videoEventLog.length = 0;
        renderVideoEventLog();
        updateVideoDiagnostics({ reason: 'assetConfigured' });
    } else {
        console.debug('[video-diagnostics] No video asset provided; falling back to storyboard mode.');
        if (videoAsset && elements.storyboardVideo) {
            elements.storyboardVideo.pause();
        }
        videoAsset = null;
        videoEl.classList.remove('active');
        videoEl.removeAttribute('src');
        videoEl.removeAttribute('poster');
        videoEl.removeAttribute('controls');
        if (elements.sceneBackdrop) {
            elements.sceneBackdrop.classList.remove('has-video');
        }
        appState.totalDurationSeconds = videoScenes.length * SCENE_DURATION_SECONDS;
        updateTimeDisplay();
        // Attempt to derive a fallback clip path if storage naming is predictable
        try {
            const maybeDoc = extractDocBase(appState.selectedFileName || '');
            if (maybeDoc) {
                // Heuristic: if container is public we can attempt direct link (will 404 silently if not)
                const guessed = `${window.location.origin}/generated-video-files/${maybeDoc.toLowerCase()}/clip.mp4`;
                console.debug('[video-diagnostics] Guessed fallback video URL:', guessed);
            }
        } catch (_) { /* ignore */ }
        updateVideoDiagnostics({ reason: 'assetCleared' });
    }
}

function attachVideoEventListeners() {
    const videoEl = elements.storyboardVideo;
    if (!videoEl || videoListenersAttached) return;
    videoListenersAttached = true;

    videoEl.addEventListener('play', () => {
        appState.isVideoPlaying = true;
        elements.playPauseButton.innerHTML = '<i class="fas fa-pause"></i>';
        logVideoEvent('play');
        updateVideoDiagnostics();
    });

    videoEl.addEventListener('pause', () => {
        if (videoEl.ended) return;
        appState.isVideoPlaying = false;
        elements.playPauseButton.innerHTML = '<i class="fas fa-play"></i>';
        logVideoEvent('pause');
        updateVideoDiagnostics();
    });

    videoEl.addEventListener('ended', () => {
        appState.isVideoPlaying = false;
        appState.currentProgress = 100;
        elements.playPauseButton.innerHTML = '<i class="fas fa-rotate-right"></i>';
        elements.progressBar.value = 100;
        updateTimeDisplay();
        logVideoEvent('ended');
        updateVideoDiagnostics();
    });

    videoEl.addEventListener('timeupdate', () => {
        syncVideoProgressFromElement();
        logVideoEvent('timeupdate');
    });

    videoEl.addEventListener('loadedmetadata', () => {
        if (videoAsset) {
            const duration = Number(videoEl.duration);
            if (Number.isFinite(duration) && duration > 0) {
                videoAsset.durationSeconds = duration;
            }
        }
        syncVideoProgressFromElement();
        logVideoEvent('loadedmetadata');
        updateVideoDiagnostics();
    });

    videoEl.addEventListener('error', (ev) => {
        const err = videoEl.error;
        console.error('[video-diagnostics] HTMLMediaElement error', err);
        showNotification('Video playback error: ' + (err?.message || 'failed to load'), 'error');
        logVideoEvent('error', { message: err?.message });
        updateVideoDiagnostics();
    });

    const diagEvents = ['playing', 'canplay', 'canplaythrough', 'waiting', 'stalled', 'suspend', 'progress', 'seeking', 'seeked', 'loadeddata', 'durationchange', 'ratechange', 'abort', 'emptied'];
    diagEvents.forEach(evt => {
        videoEl.addEventListener(evt, () => {
            logVideoEvent(evt);
            if (evt !== 'progress') {
                updateVideoDiagnostics();
            }
        });
    });
}

function syncVideoProgressFromElement() {
    if (!videoAsset || !elements.storyboardVideo) return;
    const videoEl = elements.storyboardVideo;
    const duration = Number(videoEl.duration) || videoAsset.durationSeconds || (videoScenes.length * SCENE_DURATION_SECONDS);
    if (!Number.isFinite(duration) || duration <= 0) return;

    const progress = Math.min(100, Math.max(0, (videoEl.currentTime / duration) * 100));
    appState.currentProgress = progress;
    elements.progressBar.value = Math.round(progress);
    appState.totalDurationSeconds = duration;

    if (videoScenes.length) {
        const sceneIndex = Math.min(videoScenes.length - 1, Math.floor((progress / 100) * videoScenes.length));
        if (sceneIndex !== appState.currentSceneIndex) {
            updateScene(sceneIndex, { suppressProgressSync: true });
        }
    }

    updateTimeDisplay();
}

function buildSceneFromText(text, idx) {
    const cleanText = typeof text === 'string' && text.trim().length ? text.trim() : 'Generated scene content pending.';
    return {
        index: idx + 1,
        title: createTitleFromText(cleanText, idx),
        text: cleanText,
        keywords: guessKeywords(cleanText),
        badge: idx === 0 ? 'Overview' : null,
        imageUrl: null,
        imageAlt: null,
        visualPrompt: null,
        gradient: createGradient(idx),
        mood: null
    };
}

function updateScene() { /* removed scene update logic in single video mode */ }

function renderSceneKeywords(keywords) {
    elements.sceneKeywords.innerHTML = '';
    if (!Array.isArray(keywords) || !keywords.length) return;
    keywords.slice(0, 5).forEach(word => {
        const cleaned = (word || '').toString().trim();
        if (!cleaned) return;
        const chip = document.createElement('span');
        chip.textContent = cleaned.startsWith('#') ? cleaned : `#${cleaned}`;
        elements.sceneKeywords.appendChild(chip);
    });
}

// (Scene indicators removed in single video mode)

const gradientPalette = [
    ['#2563eb', '#9333ea'],
    ['#0ea5e9', '#14b8a6'],
    ['#f97316', '#ef4444'],
    ['#6366f1', '#8b5cf6'],
    ['#f59e0b', '#10b981'],
    ['#8b5cf6', '#ec4899'],
    ['#0ea5e9', '#6366f1']
];

function createGradient(index) {
    const palette = gradientPalette[index % gradientPalette.length];
    return `linear-gradient(135deg, ${palette[0]}, ${palette[1]})`;
}

function guessKeywords(text) {
    if (!text) return [];
    const tokens = text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);
    const prioritized = tokens.filter(word => word.length > 5);
    const source = prioritized.length ? prioritized : tokens;
    const unique = [...new Set(source)];
    return unique.slice(0, 4);
}

function createTitleFromText(text, idx) {
    if (!text) return `Scene ${idx + 1}`;
    const words = text
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 6)
        .map(word => word.replace(/[^a-z0-9-]/gi, ''))
        .filter(Boolean);
    if (!words.length) return `Scene ${idx + 1}`;
    return toTitleCase(words.join(' '));
}

function toTitleCase(str) {
    if (!str) return '';
    return str
        .split(/\s+/)
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ')
        .trim();
}

function extractDocBase(name) {
    if (!name) return '';
    let base = name.split(/[\\/]/).pop() || name;
    if (base.length > 15 && /^\d{14}_/.test(base)) {
        base = base.slice(15);
    }
    if (base.includes('.')) {
        base = base.substring(0, base.lastIndexOf('.'));
    }
    return base.replace(/[_-]+/g, ' ').trim();
}

// Auto-load processed docs list on first load
document.addEventListener('DOMContentLoaded', () => {
    fetchProcessedDocs();
});

function renderQuiz(questions) {
    const container = elements.activeQuiz;
    container.innerHTML = '';
    questions.forEach((q, idx) => {
        const block = document.createElement('div');
        block.className = 'question-block';
        block.setAttribute('data-question-id', q.id || `q${idx+1}`);
        block.innerHTML = `
            <div class="question"><p class="question-text">${idx+1}. ${q.text}</p></div>
            <div class="quiz-options">
                ${q.options.map((opt,i) => `
                <label class="quiz-option">
                    <input type="radio" name="${q.id || `q${idx+1}`}" value="${opt}" data-correct="${i === q.correctIndex}">
                    <span class="option-text">${String.fromCharCode(65+i)}) ${opt}</span>
                </label>`).join('')}
            </div>
        `;
        container.appendChild(block);
    });
    elements.submitQuizButton.style.display = 'block';
}

// UI Update function
function updateUI() {
    // Upload section updates
    if (appState.isFileUploaded) {
        elements.uploadButton.innerHTML = '<i class="fas fa-check"></i> File Uploaded';
        elements.uploadButton.style.backgroundColor = '#4caf50';
    }
    
    // Processing section updates
    if (appState.isVideoReady) {
        elements.videoReadySection.style.display = 'block';
        elements.videoReadySection.classList.add('slide-in');
        elements.fileDisplaySection.style.display = 'block';
        elements.fileDisplaySection.classList.add('slide-in');
    }
    
    // Quiz section updates
    if (appState.isQuizActive) {
        document.querySelector('.quiz-intro').style.display = 'none';
        elements.activeQuiz.style.display = 'block';
        elements.activeQuiz.classList.add('fade-in');
    }
}

// Utility functions
function formatTime(seconds) {
    const safeSeconds = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
    const minutes = Math.floor(safeSeconds / 60);
    const secs = safeSeconds % 60;
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

function showNotification(message, type = 'info') {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 15px 20px;
        border-radius: 6px;
        color: white;
        z-index: 1000;
        transform: translateX(100%);
        transition: transform 0.3s ease;
    `;
    
    if (type === 'success') {
        notification.style.backgroundColor = '#4caf50';
    } else if (type === 'error') {
        notification.style.backgroundColor = '#f44336';
    } else {
        notification.style.backgroundColor = '#2196f3';
    }
    
    document.body.appendChild(notification);
    
    // Show notification
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // Hide and remove notification
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// Demo functionality for testing
function runDemo() {
    console.log('Running demo sequence...');
    
    // Simulate file upload after 1 second
    setTimeout(() => {
        const demoFile = new File(['demo content'], 'architecture-overview.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        const event = { target: { files: [demoFile] } };
        handleFileSelection(event);
    }, 1000);
}

// Keyboard shortcuts
document.addEventListener('keydown', function(event) {
    // Space bar to play/pause video (when video section is active)
    if (event.code === 'Space' && appState.isVideoReady) {
        event.preventDefault();
        handlePlayPause();
    }
    
    // Arrow keys for progress control
    // Removed scene navigation shortcuts in single video mode
});

// Console helper for development
window.appState = appState;
window.runDemo = runDemo;

console.log('KT Studio initialized successfully!');
console.log('Use runDemo() to test the application flow.');
console.log('Keyboard shortcuts: Space (play/pause).');