const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Store game states per room
// Room structure:
// {
//   players: [{id, socketId, number, ready}], // Max 2
//   turn: 0, // index of players array whose turn it is
//   round: 1, // current round (max 10)
//   status: 'waiting' | 'setting_numbers' | 'playing' | 'game_over',
//   history: [{playerId, guess, cows, bulls}] // optional, to send to players
// }
const rooms = {};

function calculateCowsAndBulls(secret, guess) {
    let cows = 0;
    let bulls = 0;
    const secretStr = String(secret);
    const guessStr = String(guess);

    for (let i = 0; i < 3; i++) {
        if (guessStr[i] === secretStr[i]) {
            bulls++;
        } else if (secretStr.includes(guessStr[i])) {
            cows++;
        }
    }
    return { cows, bulls };
}

io.on('connection', (socket) => {
    console.log('A user connected:', socket.id);

    socket.on('joinRoom', (roomCode) => {
        if (!rooms[roomCode]) {
            rooms[roomCode] = {
                players: [],
                turn: 0,
                status: 'waiting'
            };
        }

        const room = rooms[roomCode];

        if (room.players.length >= 2 && !room.players.find(p => p.socketId === socket.id)) {
            socket.emit('error', 'Room is full.');
            return;
        }

        socket.join(roomCode);

        // Add player if not already in room
        if (!room.players.find(p => p.socketId === socket.id)) {
            room.players.push({
                id: room.players.length === 0 ? 'Player 1' : 'Player 2',
                socketId: socket.id,
                number: null,
                ready: false,
                guessesMade: 0
            });
        }

        console.log(`${socket.id} joined room ${roomCode}`);
        
        socket.emit('joined', {
            roomCode,
            playerId: room.players.find(p => p.socketId === socket.id).id
        });

        if (room.players.length === 2) {
            room.status = 'setting_numbers';
            io.to(roomCode).emit('gameReady');
        } else {
            socket.emit('waitingForOpponent');
        }
    });

    socket.on('setNumber', ({ roomCode, number }) => {
        const room = rooms[roomCode];
        if (!room || room.status !== 'setting_numbers') return;

        const player = room.players.find(p => p.socketId === socket.id);
        if (player) {
            player.number = number;
            player.ready = true;
            socket.emit('numberSetSuccess');

            // Check if both ready
            if (room.players.every(p => p.ready)) {
                room.status = 'playing';
                room.turn = 0; // Player 1 starts
                room.round = 1;
                io.to(roomCode).emit('gameStarted', {
                    turn: room.players[room.turn].id
                });
            } else {
                socket.emit('waitingForOpponentNumber');
            }
        }
    });

    socket.on('makeGuess', ({ roomCode, guess }) => {
        const room = rooms[roomCode];
        if (!room || room.status !== 'playing') return;

        const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
        if (playerIndex === -1 || room.turn !== playerIndex) {
            socket.emit('error', 'Not your turn.');
            return;
        }

        const player = room.players[playerIndex];
        const opponent = room.players[playerIndex === 0 ? 1 : 0];

        const { cows, bulls } = calculateCowsAndBulls(opponent.number, guess);
        player.guessesMade++;

        // Send result to the guesser
        socket.emit('guessResult', { guess, cows, bulls });

        // Check win condition
        if (bulls === 3) {
            room.status = 'game_over';
            io.to(roomCode).emit('gameOver', {
                winner: player.id,
                reason: 'guessed_correctly',
                opponentNumber: opponent.number // Reveal opponent's number
            });
            return;
        }

        // Check draw condition (both players made 10 guesses)
        if (room.players[0].guessesMade === 10 && room.players[1].guessesMade === 10) {
            room.status = 'game_over';
            io.to(roomCode).emit('gameOver', {
                winner: 'Draw',
                reason: 'max_rounds_reached',
                player1Number: room.players[0].number,
                player2Number: room.players[1].number
            });
            return;
        }

        // Next turn
        room.turn = playerIndex === 0 ? 1 : 0;
        
        // Update round if both have played
        if (room.turn === 0) {
            room.round++;
        }

        io.to(roomCode).emit('turnUpdate', {
            turn: room.players[room.turn].id,
            round: room.round
        });
    });

    socket.on('playAgain', (roomCode) => {
        const room = rooms[roomCode];
        if (room && room.status === 'game_over') {
            // Reset state
            room.status = 'setting_numbers';
            room.turn = 0;
            room.round = 1;
            room.players.forEach(p => {
                p.number = null;
                p.ready = false;
                p.guessesMade = 0;
            });
            io.to(roomCode).emit('gameReady'); // Triggers the setting number view
        }
    });

    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id);
        // Find room and notify opponent
        for (const roomCode in rooms) {
            const room = rooms[roomCode];
            const playerIndex = room.players.findIndex(p => p.socketId === socket.id);
            if (playerIndex !== -1) {
                // Remove player
                room.players.splice(playerIndex, 1);
                io.to(roomCode).emit('opponentDisconnected');
                
                // If room empty, delete it
                if (room.players.length === 0) {
                    delete rooms[roomCode];
                } else {
                    // Reset game state for remaining player
                    room.status = 'waiting';
                    room.players[0].number = null;
                    room.players[0].ready = false;
                    room.players[0].guessesMade = 0;
                }
                break;
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
