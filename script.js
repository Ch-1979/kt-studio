// Storyboard playback configuration
const SCENE_DURATION_SECONDS = 8; // default duration per scene when animating

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
    prevSceneButton: document.getElementById('prevSceneButton'),
    nextSceneButton: document.getElementById('nextSceneButton'),
    sceneIndex: document.getElementById('sceneIndex'),
    sceneCount: document.getElementById('sceneCount'),
    sceneIndicatorRow: document.getElementById('sceneIndicatorRow'),
    storyboardVideo: document.getElementById('storyboardVideo'),
    videoControls: document.querySelector('.video-controls'),
    
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
    updateVideoPlayer();

    if (videoAsset?.mp4Url && elements.storyboardVideo) {
        elements.storyboardVideo.play().catch(() => {
            /* Autoplay might be blocked; user can press play manually */
        });
    } else {
        pausePlayback();
    }

    setTimeout(() => {
        elements.takeQuizButton.style.display = 'block';
        elements.takeQuizButton.classList.add('fade-in');
    }, 600);
}

function handlePlayPause() {
    if (!videoScenes.length) return;

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

    if (!appState.isVideoPlaying && appState.currentProgress >= 100) {
        updateScene(0, { progressOverride: 0 });
    }

    if (appState.isVideoPlaying) {
        pausePlayback();
    } else {
        startPlayback();
    }
}

function startPlayback() {
    if (!videoScenes.length) return;
    if (videoAsset?.mp4Url && elements.storyboardVideo) {
        elements.storyboardVideo.play().catch(() => {});
        return;
    }
    clearInterval(playbackInterval);

    appState.isVideoPlaying = true;
    elements.playPauseButton.innerHTML = '<i class="fas fa-pause"></i>';

    const tickMs = 200;
    const totalSeconds = Math.max(appState.totalDurationSeconds, videoScenes.length * SCENE_DURATION_SECONDS);
    const progressIncrement = (tickMs / (totalSeconds * 1000)) * 100;

    playbackInterval = setInterval(() => {
        if (!appState.isVideoPlaying) {
            clearInterval(playbackInterval);
            return;
        }

        appState.currentProgress = Math.min(100, appState.currentProgress + progressIncrement);
        elements.progressBar.value = Math.round(appState.currentProgress);
        updateTimeDisplay();

        const sceneFloat = (appState.currentProgress / 100) * videoScenes.length;
        const nextSceneIndex = Math.min(videoScenes.length - 1, Math.floor(sceneFloat));
        if (nextSceneIndex !== appState.currentSceneIndex) {
            updateScene(nextSceneIndex, { suppressProgressSync: true });
        }

        if (appState.currentProgress >= 100) {
            pausePlayback({ reachedEnd: true });
        }
    }, tickMs);
}

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
    const sceneIndex = Math.min(videoScenes.length - 1, Math.floor((value / 100) * videoScenes.length));
    pausePlayback();
    updateScene(sceneIndex, { progressOverride: value });
}

function jumpScene(delta) {
    if (!videoScenes.length) return;
    if (videoAsset?.mp4Url && elements.storyboardVideo) {
        const videoEl = elements.storyboardVideo;
        const nextIndex = Math.min(videoScenes.length - 1, Math.max(0, appState.currentSceneIndex + delta));
        const duration = Number(videoEl.duration) || videoAsset.durationSeconds || (videoScenes.length * SCENE_DURATION_SECONDS);
        if (Number.isFinite(duration) && duration > 0) {
            const fraction = nextIndex / videoScenes.length;
            videoEl.currentTime = fraction * duration;
        }
        updateScene(nextIndex, { suppressProgressSync: true });
        return;
    }
    const nextIndex = Math.min(videoScenes.length - 1, Math.max(0, appState.currentSceneIndex + delta));
    pausePlayback();
    updateScene(nextIndex);
}

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

    updateScene(appState.currentSceneIndex ?? 0, { progressOverride: appState.currentProgress });
    if (videoAsset?.mp4Url) {
        syncVideoProgressFromElement();
    } else {
        elements.progressBar.value = Math.round(appState.currentProgress);
        updateTimeDisplay();
    }
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

    const asset = normalizeVideoAsset(videoJson?.videoAsset);
    configureVideoAsset(asset);

    appState.currentSceneIndex = 0;
    appState.currentProgress = 0;
    appState.totalDurationSeconds = videoAsset?.durationSeconds || (videoScenes.length * SCENE_DURATION_SECONDS);

    renderSceneIndicators();
    updateScene(0, { progressOverride: 0 });
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
    return {
        mp4Url: raw.mp4Url,
        thumbnailUrl: raw.thumbnailUrl || null,
        durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : 0,
        prompt: raw.prompt || '',
        operationId: raw.operationId || raw.id || null,
        sourceUrl: raw.sourceUrl || null,
        thumbnailSourceUrl: raw.thumbnailSourceUrl || null
    };
}

function configureVideoAsset(asset) {
    const videoEl = elements.storyboardVideo;
    if (!videoEl) return;

    if (asset && asset.mp4Url) {
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
    } else {
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
    }
}

function attachVideoEventListeners() {
    const videoEl = elements.storyboardVideo;
    if (!videoEl || videoListenersAttached) return;
    videoListenersAttached = true;

    videoEl.addEventListener('play', () => {
        appState.isVideoPlaying = true;
        elements.playPauseButton.innerHTML = '<i class="fas fa-pause"></i>';
    });

    videoEl.addEventListener('pause', () => {
        if (videoEl.ended) return;
        appState.isVideoPlaying = false;
        elements.playPauseButton.innerHTML = '<i class="fas fa-play"></i>';
    });

    videoEl.addEventListener('ended', () => {
        appState.isVideoPlaying = false;
        appState.currentProgress = 100;
        elements.playPauseButton.innerHTML = '<i class="fas fa-rotate-right"></i>';
        elements.progressBar.value = 100;
        updateTimeDisplay();
    });

    videoEl.addEventListener('timeupdate', () => {
        syncVideoProgressFromElement();
    });

    videoEl.addEventListener('loadedmetadata', () => {
        if (videoAsset) {
            const duration = Number(videoEl.duration);
            if (Number.isFinite(duration) && duration > 0) {
                videoAsset.durationSeconds = duration;
            }
        }
        syncVideoProgressFromElement();
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

function updateScene(index, options = {}) {
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

    const { progressOverride = null, suppressProgressSync = false } = options;
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

    if (progressOverride !== null) {
        appState.currentProgress = progressOverride;
    } else if (!suppressProgressSync) {
        appState.currentProgress = (safeIndex / videoScenes.length) * 100;
    }
    elements.progressBar.value = Math.round(appState.currentProgress);
    updateTimeDisplay();
}

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
            updateTimeDisplay();
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