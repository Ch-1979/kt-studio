// Storyboard playback configuration
const MIN_SCENE_DURATION_SECONDS = 10;
const MIN_TOTAL_RUNTIME_SECONDS = 60;
const MAX_TOTAL_RUNTIME_SECONDS = 120;

// Global state management
let appState = {
    isFileUploaded: false,
    isVideoReady: false,
    isVideoPlaying: false,
    isQuizActive: false,
    currentProgress: 0,
    selectedFileName: '',
    currentSceneIndex: 0,
    totalDurationSeconds: 0,
    elapsedSeconds: 0,
    sceneDurations: [],
    sceneOffsets: []
};

let videoScenes = []; // normalized scenes currently loaded into the player
let playbackInterval = null; // interval handle for autoplay

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
    prevSceneButton: document.getElementById('prevSceneButton'),
    nextSceneButton: document.getElementById('nextSceneButton'),
    sceneIndex: document.getElementById('sceneIndex'),
    sceneCount: document.getElementById('sceneCount'),
    sceneIndicatorRow: document.getElementById('sceneIndicatorRow'),
    
    // Quiz section
    quizQuestions: document.getElementById('quizQuestions'),
    activeQuiz: document.getElementById('activeQuiz'),
    submitQuizButton: document.getElementById('submitQuizButton'),
    quizResult: document.getElementById('quizResult')
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

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    initializeEventListeners();
    updateUI();
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
    if (elements.prevSceneButton) elements.prevSceneButton.addEventListener('click', () => jumpScene(-1));
    if (elements.nextSceneButton) elements.nextSceneButton.addEventListener('click', () => jumpScene(1));
    
    // Quiz functionality
    elements.takeQuizButton.addEventListener('click', handleTakeQuiz);
    elements.submitQuizButton.addEventListener('click', handleSubmitQuiz);

    // Processed docs actions
    if (processedElements.refreshButton) processedElements.refreshButton.addEventListener('click', fetchProcessedDocs);
    if (processedElements.loadButton) processedElements.loadButton.addEventListener('click', loadSelectedProcessedDoc);
    
    // Quiz option selection
    document.addEventListener('change', function(e) {
        if (e.target.type === 'radio' && e.target.name === 'q1') {
            handleQuizOptionSelection(e.target.value);
        }
    });
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
    pausePlayback();
    updateVideoPlayer();

    setTimeout(() => {
        elements.takeQuizButton.style.display = 'block';
        elements.takeQuizButton.classList.add('fade-in');
    }, 600);
}

function handlePlayPause() {
    if (!videoScenes.length) return;

    if (!appState.isVideoPlaying && appState.elapsedSeconds >= Math.max(appState.totalDurationSeconds - 0.5, 0)) {
        updateScene(0);
        setElapsedSeconds(0, { updateScene: false });
    }

    if (appState.isVideoPlaying) {
        pausePlayback();
    } else {
        startPlayback();
    }
}

function startPlayback() {
    if (!videoScenes.length) return;
    clearInterval(playbackInterval);

    appState.isVideoPlaying = true;
    elements.playPauseButton.innerHTML = '<i class="fas fa-pause"></i>';

    const tickMs = 200;

    playbackInterval = setInterval(() => {
        if (!appState.isVideoPlaying) {
            clearInterval(playbackInterval);
            return;
        }

        const nextElapsed = appState.elapsedSeconds + tickMs / 1000;
        if (nextElapsed >= appState.totalDurationSeconds) {
            setElapsedSeconds(appState.totalDurationSeconds, { updateScene: true });
            pausePlayback({ reachedEnd: true });
            return;
        }
        setElapsedSeconds(nextElapsed, { updateScene: true });
    }, tickMs);
}

function pausePlayback(options = {}) {
    const { reachedEnd = false } = options;
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
    pausePlayback();
    const total = Math.max(appState.totalDurationSeconds, 1);
    const elapsed = (value / 100) * total;
    setElapsedSeconds(elapsed, { updateScene: true });
}

function jumpScene(delta) {
    if (!videoScenes.length) return;
    const nextIndex = Math.min(videoScenes.length - 1, Math.max(0, appState.currentSceneIndex + delta));
    pausePlayback();
    updateScene(nextIndex);
    const startTime = getSceneStartTime(nextIndex);
    setElapsedSeconds(startTime, { updateScene: false });
}

function updateTimeDisplay() {
    const total = Math.max(Math.round(appState.totalDurationSeconds || 0), 0);
    const currentSeconds = Math.round(appState.elapsedSeconds || 0);
    elements.currentTime.textContent = formatTime(currentSeconds);
    elements.totalTime.textContent = formatTime(total);
}

function updateVideoPlayer() {
    if (appState.selectedFileName) {
        elements.videoTitle.textContent = `Project: ${toTitleCase(extractDocBase(appState.selectedFileName))}`;
    }

    updateScene(appState.currentSceneIndex ?? 0);
    setElapsedSeconds(appState.elapsedSeconds || 0, { updateScene: false });
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
    processedElements.refreshButton.disabled = true;
    try {
        const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const docs = Array.isArray(data.documents) ? data.documents : [];
        populateProcessedDocsSelect(docs);
        showNotification(`Loaded ${docs.length} processed docs`, 'success');
    } catch (e) {
        console.warn('Failed to fetch processed docs', e);
        showNotification('Failed to load documents', 'error');
    } finally {
        processedElements.refreshButton.disabled = false;
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
        const resp = await fetch(`${base}/api/video/${encodeURIComponent(docName)}`, { headers: { 'Accept': 'application/json' } });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        loadedVideoData = await resp.json();
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
}

function hydrateStoryboardFromJson(videoJson) {
    const rawScenes = Array.isArray(videoJson?.scenes) ? videoJson.scenes : [];
    const normalized = normalizeScenes(rawScenes, videoJson?.summary);
    videoScenes = normalized.length ? normalized : [
        buildSceneFromText(videoJson?.summary || 'This document did not include scene details, so this is a generated overview.', 0)
    ];

    appState.currentSceneIndex = 0;
    appState.currentProgress = 0;
    const timing = calculateSceneTimings(videoScenes);
    appState.sceneDurations = timing.durations;
    appState.sceneOffsets = timing.offsets;
    appState.totalDurationSeconds = timing.total;
    appState.elapsedSeconds = 0;

    renderSceneIndicators();
    updateScene(0);
    setElapsedSeconds(0, { updateScene: false });
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

function calculateSceneTimings(scenes) {
    if (!Array.isArray(scenes) || !scenes.length) {
        return {
            durations: [],
            offsets: [],
            total: MIN_TOTAL_RUNTIME_SECONDS
        };
    }

    const wordCounts = scenes.map(scene => countWords(scene.text));
    const totalWords = wordCounts.reduce((sum, count) => sum + count, 0);

    const estimatedTotal = totalWords > 0
        ? totalWords / 2.2
        : scenes.length * (MIN_SCENE_DURATION_SECONDS + 5);

    let targetTotal = Math.max(
        MIN_TOTAL_RUNTIME_SECONDS,
        Math.min(MAX_TOTAL_RUNTIME_SECONDS, estimatedTotal)
    );

    targetTotal = Math.max(targetTotal, scenes.length * MIN_SCENE_DURATION_SECONDS);
    targetTotal = Math.round(targetTotal);
    if (!Number.isFinite(targetTotal) || targetTotal <= 0) {
        targetTotal = Math.max(MIN_TOTAL_RUNTIME_SECONDS, scenes.length * MIN_SCENE_DURATION_SECONDS);
    }

    let durations = scenes.map((scene, idx) => {
        const weight = totalWords > 0 ? wordCounts[idx] / totalWords : 1 / scenes.length;
        const share = targetTotal * weight;
        return Math.max(MIN_SCENE_DURATION_SECONDS, Math.round(share));
    });

    durations = normalizeDurations(durations, targetTotal, MIN_SCENE_DURATION_SECONDS);

    const offsets = [];
    let running = 0;
    durations.forEach((duration, idx) => {
        offsets[idx] = running;
        running += duration;
    });

    return {
        durations,
        offsets,
        total: running || targetTotal
    };
}

function normalizeDurations(durations, targetTotal, minValue) {
    if (!durations.length) return durations;

    let sum = durations.reduce((acc, duration) => acc + duration, 0);
    if (sum === 0) {
        const evenDuration = Math.max(minValue, Math.round(targetTotal / durations.length));
        return durations.map(() => evenDuration);
    }

    const scale = targetTotal / sum;
    durations = durations.map(duration => Math.max(minValue, Math.round(duration * scale)));

    let diff = targetTotal - durations.reduce((acc, duration) => acc + duration, 0);
    let guard = 0;
    while (diff !== 0 && guard < 1000) {
        for (let i = 0; i < durations.length && diff !== 0; i++) {
            if (diff > 0) {
                durations[i] += 1;
                diff -= 1;
            } else if (durations[i] > minValue) {
                durations[i] -= 1;
                diff += 1;
            }
        }
        guard++;
    }

    return durations;
}

function countWords(text) {
    if (!text) return 0;
    return text
        .toString()
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .length;
}

function getSceneStartTime(index) {
    if (!Array.isArray(appState.sceneOffsets) || !appState.sceneOffsets.length) {
        const perScene = appState.totalDurationSeconds / Math.max(videoScenes.length, 1);
        return Math.max(0, perScene * index);
    }
    const safeIndex = Math.min(Math.max(index, 0), appState.sceneOffsets.length - 1);
    return appState.sceneOffsets[safeIndex] ?? 0;
}

function getSceneIndexForElapsed(elapsed) {
    if (!Array.isArray(appState.sceneDurations) || !appState.sceneDurations.length) {
        const perScene = appState.totalDurationSeconds / Math.max(videoScenes.length, 1);
        if (perScene <= 0) return 0;
        return Math.min(videoScenes.length - 1, Math.floor(elapsed / perScene));
    }

    let running = 0;
    for (let i = 0; i < appState.sceneDurations.length; i++) {
        running += appState.sceneDurations[i];
        if (elapsed < running || i === appState.sceneDurations.length - 1) {
            return i;
        }
    }

    return appState.sceneDurations.length - 1;
}

function setElapsedSeconds(seconds, options = {}) {
    if (!videoScenes.length) {
        appState.elapsedSeconds = 0;
        appState.currentProgress = 0;
        elements.progressBar.value = 0;
        updateTimeDisplay();
        return;
    }

    const { updateScene = true, skipSliderUpdate = false } = options;
    const total = Math.max(appState.totalDurationSeconds, MIN_TOTAL_RUNTIME_SECONDS);
    const clamped = Math.min(Math.max(seconds, 0), total);
    appState.elapsedSeconds = clamped;
    appState.currentProgress = (clamped / total) * 100;

    if (!skipSliderUpdate) {
        elements.progressBar.value = Math.round(appState.currentProgress);
    }

    updateTimeDisplay();

    if (updateScene) {
        const nextIndex = getSceneIndexForElapsed(clamped);
        if (nextIndex !== appState.currentSceneIndex) {
            updateScene(nextIndex);
        } else {
            highlightSceneIndicator(nextIndex);
        }
    }
}

function updateScene(index) {
    if (!videoScenes.length) {
        elements.sceneBackdrop.style.background = createGradient(0);
        elements.sceneBadge.textContent = '';
        elements.sceneBadge.classList.add('hidden');
        elements.sceneTitle.textContent = 'Awaiting storyboard';
        elements.sceneText.textContent = 'Upload a document to generate AI-powered scenes.';
        elements.sceneKeywords.innerHTML = '';
        elements.sceneIndex.textContent = '0';
        elements.sceneCount.textContent = '0';
        return;
    }

    const safeIndex = Math.min(videoScenes.length - 1, Math.max(0, index));
    const scene = videoScenes[safeIndex];

    appState.currentSceneIndex = safeIndex;
        if (scene.imageUrl) {
            elements.sceneBackdrop.style.backgroundImage = `linear-gradient(160deg, rgba(15,23,42,0.15) 10%, rgba(15,23,42,0.9) 70%), url('${scene.imageUrl}')`;
            elements.sceneBackdrop.style.backgroundSize = 'cover';
            elements.sceneBackdrop.style.backgroundPosition = 'center';
            elements.sceneBackdrop.style.backgroundRepeat = 'no-repeat';
            elements.sceneBackdrop.classList.add('has-image');
            if (scene.imageAlt) {
                elements.sceneBackdrop.setAttribute('aria-label', scene.imageAlt);
            } else {
                elements.sceneBackdrop.removeAttribute('aria-label');
            }
        } else {
            elements.sceneBackdrop.style.backgroundImage = '';
            elements.sceneBackdrop.style.background = scene.gradient;
            elements.sceneBackdrop.classList.remove('has-image');
            elements.sceneBackdrop.removeAttribute('aria-label');
        }
        const badgeLabel = scene.badge || '';
        elements.sceneBadge.textContent = badgeLabel;
        elements.sceneBadge.classList.toggle('hidden', !badgeLabel);
    elements.sceneTitle.textContent = scene.title;
    elements.sceneText.textContent = scene.text;
    renderSceneKeywords(scene.keywords);
    elements.sceneIndex.textContent = scene.index ?? safeIndex + 1;
    elements.sceneCount.textContent = videoScenes.length;
    highlightSceneIndicator(safeIndex);
}

function renderSceneKeywords(keywords) {
    if (!elements.sceneKeywords) {
        return;
    }
    elements.sceneKeywords.innerHTML = '';
    elements.sceneKeywords.style.display = 'none';
}

function renderSceneIndicators() {
    if (!elements.sceneIndicatorRow) return;
    elements.sceneIndicatorRow.innerHTML = '';
    videoScenes.forEach((scene, idx) => {
        const dot = document.createElement('button');
        dot.className = 'scene-indicator';
        dot.type = 'button';
        dot.title = scene.title;
        dot.dataset.index = String(idx);
        dot.addEventListener('click', () => {
            pausePlayback();
            updateScene(idx);
            const startTime = getSceneStartTime(idx);
            setElapsedSeconds(startTime, { updateScene: false });
        });
        elements.sceneIndicatorRow.appendChild(dot);
    });
    highlightSceneIndicator(appState.currentSceneIndex);
}

function highlightSceneIndicator(index) {
    if (!elements.sceneIndicatorRow) return;
    [...elements.sceneIndicatorRow.children].forEach((dot, idx) => {
        dot.classList.toggle('active', idx === index);
    });
}

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
    if (event.code === 'ArrowLeft' && appState.isVideoReady) {
        event.preventDefault();
        jumpScene(-1);
    }
    
    if (event.code === 'ArrowRight' && appState.isVideoReady) {
        event.preventDefault();
        jumpScene(1);
    }
});

// Console helper for development
window.appState = appState;
window.runDemo = runDemo;

console.log('KT Studio initialized successfully!');
console.log('Use runDemo() to test the application flow.');
console.log('Keyboard shortcuts: Space (play/pause), Left/Right arrows (seek).');