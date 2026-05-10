const socket = io();

// DOM Elements
const views = {
    lobby: document.getElementById('lobby-view'),
    setup: document.getElementById('setup-view'),
    game: document.getElementById('game-view'),
    gameOver: document.getElementById('game-over-view')
};

// Lobby Elements
const roomInput = document.getElementById('room-input');
const joinBtn = document.getElementById('join-btn');
const lobbyMessage = document.getElementById('lobby-message');
const waitingMessage = document.getElementById('waiting-message');

// Setup Elements
const setNumberBtn = document.getElementById('set-number-btn');
const secretNumberInput = document.getElementById('secret-number-input');
const setupError = document.getElementById('setup-error');
const waitingOpponentSetup = document.getElementById('waiting-opponent-setup');

// Game Elements
const playerIdentity = document.getElementById('player-identity');
const roundIndicator = document.getElementById('round-indicator');
const turnIndicator = document.getElementById('turn-indicator');
const guessInput = document.getElementById('guess-input');
const guessBtn = document.getElementById('guess-btn');
const guessError = document.getElementById('guess-error');
const historyBody = document.getElementById('history-body');

// Game Over Elements
const gameOverTitle = document.getElementById('game-over-title');
const gameOverMessage = document.getElementById('game-over-message');
const opponentNumberReveal = document.getElementById('opponent-number-reveal');
const playAgainBtn = document.getElementById('play-again-btn');
const playAgainWaiting = document.getElementById('play-again-waiting');
const disconnectedOverlay = document.getElementById('disconnected-overlay');

// State
let myPlayerId = '';
let currentRoomCode = '';

// Utilities
function showView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    views[viewName].classList.remove('hidden');
    views[viewName].classList.add('active');
}

function showError(el, msg) {
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 3000);
}

function isValidNumber(numStr) {
    if (numStr.length !== 3) return false;
    if (!/^\d+$/.test(numStr)) return false;
    if (numStr.includes('0')) return false;
    const set = new Set(numStr);
    return set.size === 3;
}

// --- Event Listeners (DOM) ---

joinBtn.addEventListener('click', () => {
    const code = roomInput.value.trim().toUpperCase();
    if (code.length === 0) {
        showError(lobbyMessage, 'Please enter a valid team code.');
        return;
    }
    currentRoomCode = code;
    socket.emit('joinRoom', code);
});

setNumberBtn.addEventListener('click', () => {
    const num = secretNumberInput.value.trim();
    if (!isValidNumber(num)) {
        showError(setupError, 'Must be 3 unique digits. No zeros allowed.');
        return;
    }
    socket.emit('setNumber', { roomCode: currentRoomCode, number: num });
});

guessBtn.addEventListener('click', () => {
    const guess = guessInput.value.trim();
    if (!isValidNumber(guess)) {
        showError(guessError, 'Must be 3 unique digits. No zeros allowed.');
        return;
    }
    socket.emit('makeGuess', { roomCode: currentRoomCode, guess: guess });
    guessInput.value = '';
});

// Also allow Enter key
[roomInput, secretNumberInput, guessInput].forEach(input => {
    input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            if (input === roomInput) joinBtn.click();
            if (input === secretNumberInput) setNumberBtn.click();
            if (input === guessInput) guessBtn.click();
        }
    });
});

playAgainBtn.addEventListener('click', () => {
    socket.emit('playAgain', currentRoomCode);
    playAgainBtn.classList.add('hidden');
    playAgainWaiting.classList.remove('hidden');
});


// --- Socket Listeners ---

socket.on('joined', ({ roomCode, playerId }) => {
    myPlayerId = playerId;
    playerIdentity.textContent = playerId;
    
    // Hide input, show waiting
    joinBtn.classList.add('hidden');
    roomInput.parentElement.classList.add('hidden');
    waitingMessage.classList.remove('hidden');
});

socket.on('waitingForOpponent', () => {
    // Already handled in 'joined' mostly
});

socket.on('gameReady', () => {
    // Both players joined, or played again
    showView('setup');
    secretNumberInput.value = '';
    secretNumberInput.disabled = false;
    setNumberBtn.classList.remove('hidden');
    waitingOpponentSetup.classList.add('hidden');
    
    // Reset play again state
    playAgainBtn.classList.remove('hidden');
    playAgainWaiting.classList.add('hidden');
});

socket.on('numberSetSuccess', () => {
    secretNumberInput.disabled = true;
    setNumberBtn.classList.add('hidden');
});

socket.on('waitingForOpponentNumber', () => {
    waitingOpponentSetup.classList.remove('hidden');
});

socket.on('gameStarted', ({ turn }) => {
    showView('game');
    historyBody.innerHTML = '';
    roundIndicator.textContent = '1';
    updateTurnIndicator(turn);
});

socket.on('turnUpdate', ({ turn, round }) => {
    roundIndicator.textContent = round;
    updateTurnIndicator(turn);
});

function updateTurnIndicator(currentTurnId) {
    if (currentTurnId === myPlayerId) {
        turnIndicator.textContent = 'Your Turn!';
        turnIndicator.className = 'turn-indicator my-turn';
        guessInput.disabled = false;
        guessBtn.disabled = false;
        guessInput.focus();
    } else {
        turnIndicator.textContent = "Opponent's Turn";
        turnIndicator.className = 'turn-indicator opponent-turn';
        guessInput.disabled = true;
        guessBtn.disabled = true;
    }
}

socket.on('guessResult', ({ guess, cows, bulls }) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td><strong>${guess}</strong></td>
        <td>${cows}</td>
        <td>${bulls}</td>
    `;
    // Add to top of history
    historyBody.insertBefore(tr, historyBody.firstChild);
});

socket.on('gameOver', (data) => {
    showView('gameOver');
    
    if (data.winner === 'Draw') {
        gameOverTitle.textContent = "It's a Draw!";
        gameOverTitle.style.background = 'linear-gradient(to right, #94a3b8, #cbd5e1)';
        gameOverTitle.style.webkitBackgroundClip = 'text';
        gameOverTitle.style.webkitTextFillColor = 'transparent';
        gameOverMessage.textContent = "You both ran out of guesses!";
        opponentNumberReveal.textContent = data.player1Number === myPlayerId ? data.player2Number : data.player1Number; // Simplified since we don't have opponent ID exactly here, but server sends both.
        // Let's actually have the server send opponentNumber directly.
        // Wait, server sent player1Number and player2Number. 
        // A better way: server just sends opponentNumber always. Let's fix that conceptually, but for now we'll just check.
        // If I am Player 1, opponent is Player 2.
        opponentNumberReveal.textContent = (myPlayerId === 'Player 1') ? data.player2Number : data.player1Number;

    } else if (data.winner === myPlayerId) {
        gameOverTitle.textContent = "Victory!";
        gameOverTitle.style.background = 'linear-gradient(to right, #10b981, #34d399)';
        gameOverTitle.style.webkitBackgroundClip = 'text';
        gameOverTitle.style.webkitTextFillColor = 'transparent';
        gameOverMessage.textContent = "You cracked the code!";
        opponentNumberReveal.textContent = data.opponentNumber;
    } else {
        gameOverTitle.textContent = "Defeat!";
        gameOverTitle.style.background = 'linear-gradient(to right, #f43f5e, #fb7185)';
        gameOverTitle.style.webkitBackgroundClip = 'text';
        gameOverTitle.style.webkitTextFillColor = 'transparent';
        gameOverMessage.textContent = "Opponent cracked your code first!";
        opponentNumberReveal.textContent = data.opponentNumber; // Server sends this
    }
});

socket.on('opponentDisconnected', () => {
    disconnectedOverlay.classList.remove('hidden');
});

socket.on('error', (msg) => {
    showError(lobbyMessage, msg);
    showError(setupError, msg);
    showError(guessError, msg);
});
