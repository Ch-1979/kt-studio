// Global state management
let appState = {
    isFileUploaded: false,
    isVideoReady: false,
    isVideoPlaying: false,
    isQuizActive: false,
    currentProgress: 0,
    selectedFileName: '',
    currentVolume: 100
};

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
    currentDiagram: document.getElementById('currentDiagram'),
    audioPlayer: document.getElementById('audioPlayer'),
    currentText: document.getElementById('currentText'),
    progressBar: document.getElementById('progressBar'),
    playPauseButton: document.getElementById('playPauseButton'),
    currentTime: document.getElementById('currentTime'),
    totalTime: document.getElementById('totalTime'),
    volumeControl: document.getElementById('volumeControl'),
    
    // Quiz section
    quizQuestions: document.getElementById('quizQuestions'),
    activeQuiz: document.getElementById('activeQuiz'),
    submitQuizButton: document.getElementById('submitQuizButton'),
    quizResult: document.getElementById('quizResult')
};

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
    elements.volumeControl.addEventListener('input', handleVolumeChange);
    
    // Quiz functionality
    elements.takeQuizButton.addEventListener('click', handleTakeQuiz);
    elements.submitQuizButton.addEventListener('click', handleSubmitQuiz);
    
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

function handleFileSelection(event) {
    const file = event.target.files[0];
    if (file) {
        appState.selectedFileName = file.name;
        appState.isFileUploaded = true;
        
        // Show upload status
        elements.uploadStatus.textContent = `File selected: ${file.name}`;
        elements.uploadStatus.style.display = 'block';
        elements.uploadStatus.classList.add('fade-in');
        
        // Simulate file processing
        setTimeout(() => {
            simulateFileProcessing();
        }, 1500);
        
        updateUI();
    }
}

function simulateFileProcessing() {
    // Update status to processing
    elements.videoStatus.textContent = 'Status: Processing...';
    
    // After processing delay, show video ready
    setTimeout(() => {
        appState.isVideoReady = true;
        elements.videoStatus.textContent = 'Status: Ready!';
        elements.fileNameDisplay.textContent = appState.selectedFileName;
        updateUI();
    }, 2000);
}

// Video functionality
function handleWatchVideo() {
    // Show video content and update UI
    appState.isVideoPlaying = false; // Start paused
    updateVideoPlayer();
    
    // Show quiz button after a short delay
    setTimeout(() => {
        elements.takeQuizButton.style.display = 'block';
        elements.takeQuizButton.classList.add('fade-in');
    }, 1000);
}

function handlePlayPause() {
    appState.isVideoPlaying = !appState.isVideoPlaying;
    
    if (appState.isVideoPlaying) {
        elements.playPauseButton.innerHTML = '<i class="fas fa-pause"></i>';
        simulateVideoProgress();
    } else {
        elements.playPauseButton.innerHTML = '<i class="fas fa-play"></i>';
    }
}

function simulateVideoProgress() {
    if (!appState.isVideoPlaying) return;
    
    const progressInterval = setInterval(() => {
        if (!appState.isVideoPlaying || appState.currentProgress >= 100) {
            clearInterval(progressInterval);
            if (appState.currentProgress >= 100) {
                elements.playPauseButton.innerHTML = '<i class="fas fa-replay"></i>';
                appState.currentProgress = 0;
            }
            return;
        }
        
        appState.currentProgress += 1;
        elements.progressBar.value = appState.currentProgress;
        updateTimeDisplay();
        
        // Update content based on progress
        updateVideoContent();
    }, 100);
}

function updateVideoContent() {
    const progress = appState.currentProgress;
    
    if (progress < 30) {
        elements.currentText.textContent = "The architecture shows the data flow from the user application through the API Gateway to our microservices layer...";
    } else if (progress < 60) {
        elements.currentText.textContent = "The API Gateway acts as a single entry point, handling authentication, rate limiting, and routing requests to appropriate microservices...";
    } else if (progress < 90) {
        elements.currentText.textContent = "Our microservices architecture ensures scalability and maintainability by breaking down functionality into independent, deployable services...";
    } else {
        elements.currentText.textContent = "Finally, all data is persistently stored in our database layer, ensuring data consistency and reliability across the entire system.";
    }
}

function handleProgressChange(event) {
    appState.currentProgress = parseInt(event.target.value);
    updateTimeDisplay();
    updateVideoContent();
}

function handleVolumeChange(event) {
    appState.currentVolume = parseInt(event.target.value);
    elements.audioPlayer.volume = appState.currentVolume / 100;
}

function updateTimeDisplay() {
    const current = Math.floor((appState.currentProgress / 100) * 330); // 5:30 = 330 seconds
    const currentMinutes = Math.floor(current / 60);
    const currentSeconds = current % 60;
    
    elements.currentTime.textContent = `${currentMinutes}:${currentSeconds.toString().padStart(2, '0')}`;
}

function updateVideoPlayer() {
    // Update video title based on selected file
    if (appState.selectedFileName) {
        const fileBaseName = appState.selectedFileName.split('.')[0];
        elements.videoTitle.textContent = `Project Alpha: ${fileBaseName.charAt(0).toUpperCase() + fileBaseName.slice(1)}`;
    }
    
    // Reset video state
    appState.currentProgress = 0;
    elements.progressBar.value = 0;
    elements.playPauseButton.innerHTML = '<i class="fas fa-play"></i>';
    updateTimeDisplay();
    updateVideoContent();
}

// Quiz functionality
function handleTakeQuiz() {
    appState.isQuizActive = true;
    updateUI();

    // Attempt to fetch quiz dynamically from backend API (Azure Functions)
    fetchQuizData();

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
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
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
        appState.currentProgress = Math.max(0, appState.currentProgress - 5);
        elements.progressBar.value = appState.currentProgress;
        updateTimeDisplay();
        updateVideoContent();
    }
    
    if (event.code === 'ArrowRight' && appState.isVideoReady) {
        event.preventDefault();
        appState.currentProgress = Math.min(100, appState.currentProgress + 5);
        elements.progressBar.value = appState.currentProgress;
        updateTimeDisplay();
        updateVideoContent();
    }
});

// Console helper for development
window.appState = appState;
window.runDemo = runDemo;

console.log('KT Studio initialized successfully!');
console.log('Use runDemo() to test the application flow.');
console.log('Keyboard shortcuts: Space (play/pause), Left/Right arrows (seek).');