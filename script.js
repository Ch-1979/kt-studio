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
    totalDurationSeconds: 0,
    currentDocName: '',
    chatHistory: []
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

const chatbotElements = {
    container: document.querySelector('.chatbot-container'),
    launcher: document.getElementById('chatbotLauncher'),
    panel: document.getElementById('chatbotPanel'),
    closeButton: document.getElementById('chatbotCloseButton'),
    messages: document.getElementById('chatbotMessages'),
    status: document.getElementById('chatbotStatus'),
    input: document.getElementById('chatbotInput'),
    sendButton: document.getElementById('chatbotSendButton'),
    docLabel: document.getElementById('chatbotDocLabel')
};

const chatbotState = {
    isOpen: false,
    isThinking: false,
    hasGreeted: false,
    statusIdleMessage: 'Select a document to unlock contextual Q&A.',
    lastDocName: null
};

let loadedVideoData = null; // stores currently loaded generated video JSON
let loadedQuizData = null;  // stores currently loaded generated quiz JSON
let quizState = {
    questions: [],
    currentQuestionIndex: 0,
    userAnswers: {},
    isSubmitted: false
};

// Initialize the application
document.addEventListener('DOMContentLoaded', function() {
    initializeEventListeners();
    updateUI();
    initializeChatbot();
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
        if (e.target && e.target.type === 'radio' && e.target.name) {
            handleQuizOptionSelection();
        }
    });

    // Chatbot interactions
    if (chatbotElements.launcher) chatbotElements.launcher.addEventListener('click', () => toggleChatbot());
    if (chatbotElements.closeButton) chatbotElements.closeButton.addEventListener('click', closeChatbot);
    if (chatbotElements.sendButton) chatbotElements.sendButton.addEventListener('click', sendChatbotMessage);
    if (chatbotElements.input) {
        chatbotElements.input.addEventListener('input', updateChatbotInputState);
        chatbotElements.input.addEventListener('keydown', function(event) {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendChatbotMessage();
            }
        });
    }

    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && chatbotState.isOpen) {
            closeChatbot();
        }
    });

    // Tutorial video link
    const tutorialLink = document.getElementById('tutorialLink');
    if (tutorialLink) {
        tutorialLink.addEventListener('click', function(event) {
            event.preventDefault();
            toggleTutorialVideo();
        });
    }
}

function toggleTutorialVideo() {
    const videoPlayer = document.getElementById('tutorialVideoPlayer');
    const video = document.getElementById('tutorialVideo');
    const link = document.getElementById('tutorialLink');
    
    if (videoPlayer && video && link) {
        if (videoPlayer.style.display === 'none') {
            videoPlayer.style.display = 'block';
            link.innerHTML = '<i class="fas fa-times-circle"></i> Hide tutorial video';
            setTimeout(() => {
                videoPlayer.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 100);
        } else {
            video.pause();
            videoPlayer.style.display = 'none';
            link.innerHTML = '<i class="fas fa-play-circle"></i> Click here to watch tutorial video';
        }
    }
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
    appState.currentDocName = meta.docName || '';
    updateChatbotContext();
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
    const sceneIndex = Math.min(videoScenes.length - 1, Math.floor((value / 100) * videoScenes.length));
    pausePlayback();
    updateScene(sceneIndex, { progressOverride: value });
}

function jumpScene(delta) {
    if (!videoScenes.length) return;
    const nextIndex = Math.min(videoScenes.length - 1, Math.max(0, appState.currentSceneIndex + delta));
    pausePlayback();
    updateScene(nextIndex);
}

function updateTimeDisplay() {
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
    elements.progressBar.value = Math.round(appState.currentProgress);
    updateTimeDisplay();
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

function handleQuizOptionSelection() {
    elements.submitQuizButton.style.display = 'block';
    elements.submitQuizButton.classList.add('fade-in');
}

function handleSubmitQuiz() {
    // Check if all questions are answered
    const totalQuestions = quizState.questions.length;
    const answeredCount = Object.keys(quizState.userAnswers).length;
    
    if (answeredCount < totalQuestions) {
        showQuizResult({ 
            message: `Please answer all questions. You've answered ${answeredCount} of ${totalQuestions}.`, 
            type: 'warning' 
        });
        return;
    }
    
    quizState.isSubmitted = true;
    
    // Calculate score
    let correctCount = 0;
    quizState.questions.forEach((q, idx) => {
        const qId = q.id || `q${idx + 1}`;
        const userAnswer = quizState.userAnswers[qId];
        const correctAnswer = q.options[q.correctIndex];
        
        if (userAnswer === correctAnswer) {
            correctCount++;
        }
    });
    
    const scorePercent = Math.round((correctCount / totalQuestions) * 100);
    let message;
    let type;
    
    if (scorePercent >= 70) {
        message = 'Great job! You passed the knowledge check.';
        type = 'correct';
    } else if (scorePercent >= 60) {
        message = 'Almost there. Review the material and try again.';
        type = 'partial';
    } else {
        message = 'Some answers are incorrect. Review the material and try again.';
        type = 'incorrect';
    }
    
    showQuizResult({
        message,
        type,
        scorePercent,
        correctCount,
        totalQuestions
    });
    
    // Re-render current question with results
    renderCurrentQuestionWithResults();
    
    // Update submit button
    elements.submitQuizButton.textContent = 'Review Answers';
    elements.submitQuizButton.onclick = () => {
        // Allow navigation through results
        quizState.currentQuestionIndex = 0;
        renderCurrentQuestionWithResults();
    };
}

function renderCurrentQuestionWithResults() {
    const currentQ = quizState.questions[quizState.currentQuestionIndex];
    const questionContainer = document.getElementById('currentQuestionContainer');
    const qId = currentQ.id || `q${quizState.currentQuestionIndex + 1}`;
    const userAnswer = quizState.userAnswers[qId];
    const correctAnswer = currentQ.options[currentQ.correctIndex];
    
    if (!questionContainer) return;
    
    questionContainer.innerHTML = `
        <div class="question-block active-question" data-question-id="${qId}">
            <div class="question">
                <p class="question-text">Question ${quizState.currentQuestionIndex + 1} of ${quizState.questions.length}</p>
                <h4 class="question-title">${currentQ.text}</h4>
            </div>
            <div class="quiz-options">
                ${currentQ.options.map((opt, i) => {
                    const isUserAnswer = userAnswer === opt;
                    const isCorrect = opt === correctAnswer;
                    let classes = 'quiz-option';
                    
                    if (isCorrect) {
                        classes += ' correct-choice';
                    }
                    if (isUserAnswer && !isCorrect) {
                        classes += ' incorrect-choice';
                    }
                    if (isUserAnswer) {
                        classes += ' selected-choice';
                    }
                    
                    return `
                    <label class="${classes}">
                        <input type="radio" name="${qId}" value="${opt}" ${isUserAnswer ? 'checked' : ''} disabled>
                        <span class="option-text">${String.fromCharCode(65 + i)}) ${opt}</span>
                    </label>`;
                }).join('')}
            </div>
        </div>
    `;
    
    updateQuizNavigation();
}
    elements.submitQuizButton.style.display = 'none';
}

function showQuizResult({ message, type = 'info', scorePercent = null, correctCount = null, totalQuestions = null }) {
    const resultEl = elements.quizResult;
    if (!resultEl) return;

    resultEl.innerHTML = '';

    const messageEl = document.createElement('p');
    messageEl.className = 'quiz-result-message';
    messageEl.textContent = message;
    resultEl.appendChild(messageEl);

    if (scorePercent !== null && correctCount !== null && totalQuestions !== null) {
        const clampedPercent = Math.min(100, Math.max(0, scorePercent));
        const scoreLine = document.createElement('p');
        scoreLine.className = 'quiz-result-score';
        scoreLine.textContent = `Score: ${clampedPercent}% (${correctCount}/${totalQuestions} correct)`;
        resultEl.appendChild(scoreLine);

        const bar = document.createElement('div');
        bar.className = 'quiz-score-bar';
        const fill = document.createElement('div');
        fill.className = 'quiz-score-bar-fill';
        fill.style.width = `${clampedPercent}%`;

        if (type === 'correct') {
            fill.classList.add('pass');
        } else if (type === 'partial' || type === 'warning') {
            fill.classList.add('partial');
        } else if (type === 'incorrect') {
            fill.classList.add('fail');
        } else {
            fill.classList.add('neutral');
        }

        bar.appendChild(fill);
        resultEl.appendChild(bar);
    }

    resultEl.className = `quiz-result ${type}`;
    resultEl.style.display = 'block';
    resultEl.classList.add('fade-in');
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
    appState.currentDocName = docName || '';
    updateChatbotContext();
    elements.videoStatus.textContent = 'Status: Ready (loaded)';
    elements.fileNameDisplay.textContent = docName + '.txt';
    hydrateStoryboardFromJson(videoJson);
    updateUI();
    if (loadedQuizData && loadedQuizData.questions) {
        elements.takeQuizButton.style.display = 'block';
    }
}

// ---------------- Chatbot Integration ---------------- //

function initializeChatbot() {
    if (chatbotElements.panel) {
        chatbotElements.panel.classList.add('empty');
        chatbotElements.panel.setAttribute('aria-hidden', 'true');
    }
    if (chatbotElements.launcher) {
        chatbotElements.launcher.setAttribute('aria-expanded', 'false');
    }
    updateChatbotContext();
    refreshChatbotStatus();
    updateChatbotInputState();
}

function toggleChatbot(forceOpen) {
    const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !chatbotState.isOpen;
    if (shouldOpen) {
        openChatbot();
    } else {
        closeChatbot();
    }
}

function openChatbot() {
    if (!chatbotElements.panel) return;
    chatbotState.isOpen = true;
    chatbotElements.panel.classList.add('open');
    chatbotElements.panel.setAttribute('aria-hidden', 'false');
    if (chatbotElements.launcher) {
        chatbotElements.launcher.setAttribute('aria-expanded', 'true');
    }
    ensureChatbotGreeting();
    scrollChatToBottom();
    setTimeout(() => {
        if (chatbotElements.input && !chatbotElements.input.disabled) {
            chatbotElements.input.focus();
        }
    }, 120);
}

function closeChatbot() {
    if (!chatbotElements.panel) return;
    chatbotState.isOpen = false;
    chatbotElements.panel.classList.remove('open');
    chatbotElements.panel.setAttribute('aria-hidden', 'true');
    if (chatbotElements.launcher) {
        chatbotElements.launcher.setAttribute('aria-expanded', 'false');
    }
}

function ensureChatbotGreeting() {
    if (chatbotState.hasGreeted) return;
    appendChatbotMessage('assistant', "Hi! I'm your Q&A bot. Load or select a KT document and I'll answer questions using its storyboard and quiz context.");
    chatbotState.hasGreeted = true;
}

function appendChatbotMessage(role, text, sources, meta = {}) {
    if (!chatbotElements.messages) return;
    if (chatbotElements.panel) {
        chatbotElements.panel.classList.remove('empty');
    }

    const safeRole = role === 'user' ? 'user' : 'assistant';
    const wrapper = document.createElement('div');
    wrapper.className = `chat-message chat-${safeRole}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    appendTextAsParagraphs(bubble, text);

    if (safeRole === 'assistant' && meta.error) {
        const errorNote = document.createElement('div');
        errorNote.style.marginTop = '8px';
        errorNote.style.fontSize = '12px';
        errorNote.style.color = '#b91c1c';
        errorNote.textContent = meta.error;
        bubble.appendChild(errorNote);
    }

    wrapper.appendChild(bubble);
    chatbotElements.messages.appendChild(wrapper);
    scrollChatToBottom();
}

function appendTextAsParagraphs(container, text) {
    const content = (text || '').toString().trim();
    if (!content) {
        const emptyParagraph = document.createElement('p');
        emptyParagraph.textContent = 'No response available right now.';
        container.appendChild(emptyParagraph);
        return;
    }

    content.split(/\n{2,}/).forEach((block) => {
        const paragraph = document.createElement('p');
        paragraph.textContent = block.replace(/\n/g, ' ').trim();
        container.appendChild(paragraph);
    });
}

function scrollChatToBottom() {
    if (!chatbotElements.messages) return;
    chatbotElements.messages.scrollTop = chatbotElements.messages.scrollHeight;
}

function updateChatbotContext() {
    const docName = (appState.currentDocName || '').trim();
    const friendlyDocName = docName ? extractDocBase(docName) || docName : '';

    if (chatbotElements.docLabel) {
        chatbotElements.docLabel.textContent = friendlyDocName ? `Context: ${friendlyDocName}` : 'No document selected';
    }

    if (chatbotElements.input) {
        if (friendlyDocName) {
            chatbotElements.input.placeholder = `Ask something about ${friendlyDocName}...`;
        } else {
            chatbotElements.input.placeholder = 'Questions will unlock after selecting a doc.';
            chatbotElements.input.value = '';
        }
    }

    chatbotState.statusIdleMessage = docName
        ? 'Ask a question and I will reference your storyboard and quiz context.'
        : 'Select a document to unlock contextual Q&A.';

    if (docName && chatbotState.hasGreeted && docName !== chatbotState.lastDocName) {
        const announcementName = friendlyDocName || docName;
    appendChatbotMessage('assistant', `Context is ready for ${announcementName}. Ask me anything about this KT package for quick answers.`);
    }

    chatbotState.lastDocName = docName || null;

    refreshChatbotStatus();
    updateChatbotInputState();
}

function refreshChatbotStatus() {
    if (!chatbotElements.status) return;
    chatbotElements.status.textContent = chatbotState.isThinking ? 'Thinking...' : chatbotState.statusIdleMessage;
}

function updateChatbotInputState() {
    if (!chatbotElements.sendButton || !chatbotElements.input) return;
    const hasDoc = Boolean(getActiveDocName());
    const hasQuestion = chatbotElements.input.value.trim().length > 0;
    const canSend = hasDoc && hasQuestion && !chatbotState.isThinking;

    chatbotElements.sendButton.disabled = !canSend;
    chatbotElements.sendButton.classList.toggle('is-thinking', chatbotState.isThinking);
    chatbotElements.input.disabled = chatbotState.isThinking ? true : !hasDoc;
}

function getActiveDocName() {
    return (appState.currentDocName || '').trim();
}

async function sendChatbotMessage() {
    if (!chatbotElements.input || !chatbotElements.sendButton) return;
    if (chatbotState.isThinking) return;

    const question = chatbotElements.input.value.trim();
    const docName = getActiveDocName();

    if (!question || !docName) {
        updateChatbotInputState();
        return;
    }

    appendChatbotMessage('user', question);
    appState.chatHistory.push({ role: 'user', message: question, timestamp: Date.now() });
    chatbotElements.input.value = '';
    updateChatbotInputState();
    setChatbotThinking(true);

    try {
        const base = window.location.origin;
        const response = await fetch(`${base}/api/chatbot/ask`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ question, docName })
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json();
        const answer = payload.answer || "I'm not sure how to answer that right now.";
    appendChatbotMessage('assistant', answer, payload.sources, { error: payload.error });
    appState.chatHistory.push({ role: 'assistant', message: answer, timestamp: Date.now(), sources: payload.sources, error: payload.error });
    } catch (error) {
        console.error('Chatbot request failed', error);
        appendChatbotMessage('assistant', "I couldn't reach the knowledge base right now. Please try again in a moment.");
    } finally {
        setChatbotThinking(false);
    }
}

function setChatbotThinking(isThinking) {
    chatbotState.isThinking = isThinking;
    refreshChatbotStatus();
    updateChatbotInputState();
}

function hydrateStoryboardFromJson(videoJson) {
    const rawScenes = Array.isArray(videoJson?.scenes) ? videoJson.scenes : [];
    const normalized = normalizeScenes(rawScenes, videoJson?.summary);
    videoScenes = normalized.length ? normalized : [
        buildSceneFromText(videoJson?.summary || 'This document did not include scene details, so this is a generated overview.', 0)
    ];

    appState.currentSceneIndex = 0;
    appState.currentProgress = 0;
    appState.totalDurationSeconds = videoScenes.length * SCENE_DURATION_SECONDS;

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
        elements.sceneBadge.textContent = 'Welcome';
        elements.sceneBadge.classList.remove('hidden');
        elements.sceneTitle.textContent = 'Your AI storyboard will appear here';
    elements.sceneText.textContent = 'Upload a KT document to generate a video and a quiz tailored to your content. Once processing finishes, the full storyboard will play in this space.';
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
    quizState.questions = questions;
    quizState.currentQuestionIndex = 0;
    quizState.userAnswers = {};
    quizState.isSubmitted = false;
    
    const container = elements.activeQuiz;
    container.innerHTML = '';
    
    // Create quiz navigation container
    const quizNavContainer = document.createElement('div');
    quizNavContainer.className = 'quiz-navigation-container';
    quizNavContainer.innerHTML = `
        <div id="currentQuestionContainer" class="current-question-container"></div>
        <div class="quiz-nav-controls">
            <button id="prevQuizButton" class="quiz-nav-btn" disabled>
                <i class="fas fa-arrow-left"></i> Previous
            </button>
            <span id="quizProgress" class="quiz-progress">1 of ${questions.length}</span>
            <button id="nextQuizButton" class="quiz-nav-btn">
                Next <i class="fas fa-arrow-right"></i>
            </button>
        </div>
    `;
    
    container.appendChild(quizNavContainer);
    
    // Render first question
    renderCurrentQuestion();
    
    // Add navigation event listeners
    document.getElementById('prevQuizButton').addEventListener('click', () => navigateQuiz(-1));
    document.getElementById('nextQuizButton').addEventListener('click', () => navigateQuiz(1));
    
    elements.submitQuizButton.style.display = 'block';
    elements.submitQuizButton.textContent = 'Submit Quiz';
}

function renderCurrentQuestion() {
    const currentQ = quizState.questions[quizState.currentQuestionIndex];
    const questionContainer = document.getElementById('currentQuestionContainer');
    const qId = currentQ.id || `q${quizState.currentQuestionIndex + 1}`;
    
    if (!questionContainer) return;
    
    questionContainer.innerHTML = `
        <div class="question-block active-question" data-question-id="${qId}">
            <div class="question">
                <p class="question-text">Question ${quizState.currentQuestionIndex + 1} of ${quizState.questions.length}</p>
                <h4 class="question-title">${currentQ.text}</h4>
            </div>
            <div class="quiz-options">
                ${currentQ.options.map((opt, i) => {
                    const isChecked = quizState.userAnswers[qId] === opt ? 'checked' : '';
                    return `
                    <label class="quiz-option ${quizState.userAnswers[qId] === opt ? 'selected-choice' : ''}">
                        <input type="radio" name="${qId}" value="${opt}" data-correct="${i === currentQ.correctIndex}" ${isChecked}>
                        <span class="option-text">${String.fromCharCode(65 + i)}) ${opt}</span>
                    </label>`;
                }).join('')}
            </div>
        </div>
    `;
    
    // Add change listener to save answer
    questionContainer.querySelectorAll('input[type="radio"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            quizState.userAnswers[qId] = e.target.value;
            // Update visual selection
            questionContainer.querySelectorAll('.quiz-option').forEach(opt => opt.classList.remove('selected-choice'));
            e.target.closest('.quiz-option').classList.add('selected-choice');
        });
    });
    
    updateQuizNavigation();
}

function navigateQuiz(direction) {
    const newIndex = quizState.currentQuestionIndex + direction;
    
    if (newIndex >= 0 && newIndex < quizState.questions.length) {
        quizState.currentQuestionIndex = newIndex;
        renderCurrentQuestion();
    }
}

function updateQuizNavigation() {
    const prevBtn = document.getElementById('prevQuizButton');
    const nextBtn = document.getElementById('nextQuizButton');
    const progress = document.getElementById('quizProgress');
    
    if (prevBtn) prevBtn.disabled = quizState.currentQuestionIndex === 0;
    if (nextBtn) nextBtn.disabled = quizState.currentQuestionIndex === quizState.questions.length - 1;
    if (progress) progress.textContent = `${quizState.currentQuestionIndex + 1} of ${quizState.questions.length}`;
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
    const targetEl = event.target;
    const isTypingContext =
        targetEl && (
            (targetEl.tagName === 'INPUT' && targetEl.type !== 'range') ||
            targetEl.tagName === 'TEXTAREA' ||
            targetEl.isContentEditable
        );

    if (isTypingContext) {
        return;
    }

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