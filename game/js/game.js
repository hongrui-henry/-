// Game class depends on global classes loaded before it

class Game {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.width = 1024;
        this.height = 768;
        this.canvas.width = this.width;
        this.canvas.height = this.height;

        this.input = new InputHandler();
        this.lastTime = 0;

        this.map = new Map(this.width, this.height);
        this.tanks = [];
        this.bullets = [];
        this.explosions = [];
        this.ais = [];
        this.remotePlayers = {}; // Map of id -> Tank

        this.gameState = 'MENU';
        this.initUI();
        this.loop(0);
    }

    initUI() {
        document.getElementById('btn-pve').addEventListener('click', () => this.startGame('PVE'));
        document.getElementById('btn-pvp').addEventListener('click', () => this.startGame('PVP'));
        document.getElementById('btn-online').addEventListener('click', () => this.startOnlineGame());
        document.getElementById('btn-restart').addEventListener('click', () => {
            if (this.currentMode === 'ONLINE') {
                window.location.reload();
            } else {
                this.startGame(this.currentMode);
            }
        });
        document.getElementById('btn-menu').addEventListener('click', () => this.showMenu());
    }

    showMenu() {
        this.gameState = 'MENU';
        document.getElementById('main-menu').classList.remove('hidden');
        document.getElementById('game-over').classList.add('hidden');
        document.getElementById('hud').classList.add('hidden');
    }

    startOnlineGame() {
        this.currentMode = 'ONLINE';
        this.gameState = 'PLAYING';
        document.getElementById('main-menu').classList.add('hidden');
        document.getElementById('game-over').classList.add('hidden');
        document.getElementById('hud').classList.remove('hidden');

        this.tanks = [];
        this.bullets = [];
        this.explosions = [];
        this.ais = [];
        this.remotePlayers = {};

        console.log('Connecting to server...');
        // Use window.location.hostname to support LAN if needed, or localhost default
        const serverUrl = 'http://localhost:4000';
        this.socket = io(serverUrl);

        this.socket.on('connect', () => {
            console.log('Connected to server with ID:', this.socket.id);
        });

        this.socket.on('currentPlayers', (players) => {
            Object.keys(players).forEach((id) => {
                if (id === this.socket.id) {
                    // My Tank
                    const p1Controls = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', shoot: 'Space', dash: 'ShiftLeft' };
                    const p = players[id];
                    const myTank = new Tank(p.x, p.y, p.color, p1Controls, this);
                    myTank.id = id;
                    myTank.rotation = p.rotation;
                    myTank.health = p.health;
                    this.tanks.push(myTank);
                    this.myTank = myTank;
                } else {
                    this.addRemotePlayer(players[id]);
                }
            });
        });

        this.socket.on('newPlayer', (playerInfo) => {
            this.addRemotePlayer(playerInfo);
        });

        this.socket.on('playerMoved', (playerInfo) => {
            if (this.remotePlayers[playerInfo.id]) {
                const t = this.remotePlayers[playerInfo.id];
                t.x = playerInfo.x;
                t.y = playerInfo.y;
                t.rotation = playerInfo.rotation;
            }
        });

        this.socket.on('playerDisconnected', (id) => {
            if (this.remotePlayers[id]) {
                this.tanks = this.tanks.filter(t => t !== this.remotePlayers[id]);
                delete this.remotePlayers[id];
            }
        });

        this.socket.on('playerShot', (data) => {
            const bullet = new Bullet(data.x, data.y, data.rotation, data.color);
            // Mark bullet as remote if it's not mine? or just treat all same
            // For hit detection in Online, only I check if I am hit by others.
            // But for visuals, we add all bullets.
            // If I shot it, I already added it locally? No, let's rely on server echo for simplicity 
            // OR ignore echo if I added it.
            // Simpler: Just render what server says. But latency...
            // Hybrid: I shout locally immediately. Ignore echo for self?
            // Let's simpler: Add all bullets. If duplicate, visually minor.
            this.addBullet(bullet);
        });

        this.socket.on('playerHealthUpdate', (data) => {
            const t = this.tanks.find(tank => tank.id === data.id);
            if (t) t.health = data.health;
        });

        this.socket.on('playerDied', (id) => {
            const t = this.tanks.find(tank => tank.id === id);
            if (t) {
                this.createExplosion(t.x, t.y, t.color);
                t.health = 0;
                if (t === this.myTank) {
                    this.endGame('YOU DIED');
                }
            }
        });

        this.socket.on('playerRespawn', (data) => {
            const t = this.tanks.find(tank => tank.id === data.id);
            if (t) {
                t.x = data.x;
                t.y = data.y;
                t.health = 100;
                if (t === this.myTank) {
                    this.gameState = 'PLAYING';
                    document.getElementById('game-over').classList.add('hidden');
                }
                this.createExplosion(t.x, t.y, '#fff'); // Respawn effect
            }
        });
    }

    addRemotePlayer(playerInfo) {
        const remoteTank = new Tank(playerInfo.x, playerInfo.y, playerInfo.color, {}, this);
        remoteTank.id = playerInfo.id;
        remoteTank.rotation = playerInfo.rotation;
        remoteTank.health = playerInfo.health;
        this.tanks.push(remoteTank);
        this.remotePlayers[playerInfo.id] = remoteTank;
    }

    startGame(mode) {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.currentMode = mode;
        this.gameState = 'PLAYING';
        document.getElementById('main-menu').classList.add('hidden');
        document.getElementById('game-over').classList.add('hidden');
        document.getElementById('hud').classList.remove('hidden');

        this.tanks = [];
        this.bullets = [];
        this.explosions = [];
        this.ais = [];
        this.myTank = null; // Reset

        // Player 1
        const p1Controls = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', shoot: 'Space', dash: 'ShiftLeft' };
        const p1 = new Tank(100, 100, '#00f3ff', p1Controls, this);
        this.tanks.push(p1);
        this.myTank = p1; // For HUD mainly

        // Player 2 or AI
        if (mode === 'PVP') {
            const p2Controls = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', shoot: 'Enter', dash: 'ShiftRight' };
            this.tanks.push(new Tank(900, 600, '#ff00ff', p2Controls, this));
        } else {
            // AI Tank
            const aiControls = { up: 'up', down: 'down', left: 'left', right: 'right', shoot: 'shoot', dash: 'dash' };
            const aiTank = new Tank(900, 600, '#ff00ff', aiControls, this);
            this.tanks.push(aiTank);
            this.ais.push(new AIController(aiTank, this.tanks[0], this.map));
        }
    }

    addBullet(bullet) {
        this.bullets.push(bullet);
    }

    createExplosion(x, y, color) {
        for (let i = 0; i < 10; i++) {
            this.explosions.push({
                x, y,
                vx: (Math.random() - 0.5) * 5,
                vy: (Math.random() - 0.5) * 5,
                life: 1.0,
                color
            });
        }
    }

    update(deltaTime) {
        if (this.gameState !== 'PLAYING') return;

        // cleanup
        this.bullets = this.bullets.filter(b => !b.markedForDeletion);
        this.explosions = this.explosions.filter(e => e.life > 0);

        // Update AI
        this.ais.forEach(ai => {
            const controls = ai.update(deltaTime);
            const mockInput = { isKeyDown: (code) => controls[code] === true || (code === 'shoot' && controls.shoot) || (code === 'dash' && controls.dash) };
            ai.tank.update(deltaTime, mockInput);
        });

        // Update Tanks
        this.tanks.forEach((tank) => {
            if (this.ais.find(ai => ai.tank === tank)) return;

            // If remote tank, update via socket events only (position interpolation done in socket handler mostly, direct set here)
            // Or allow interpolation in update? For now direct set.
            if (this.currentMode === 'ONLINE' && tank !== this.myTank) return;

            const prevX = tank.x;
            const prevY = tank.y;
            const prevRot = tank.rotation;

            tank.update(deltaTime, this.input);

            // Online Sync
            if (this.currentMode === 'ONLINE' && tank === this.myTank) {
                if (tank.x !== prevX || tank.y !== prevY || tank.rotation !== prevRot) {
                    this.socket.emit('playerMovement', { x: tank.x, y: tank.y, rotation: tank.rotation });
                }

                // Hook shoot hack
                if (!tank._shootHooked) {
                    const origShoot = tank.shoot.bind(tank);
                    tank.shoot = (time) => {
                        if (time - tank.lastShotTime > tank.shootCooldown) {
                            origShoot(time);
                            this.socket.emit('shoot', {
                                x: tank.x + Math.cos(tank.rotation) * 30,
                                y: tank.y + Math.sin(tank.rotation) * 30,
                                rotation: tank.rotation
                            });
                        }
                    };
                    tank._shootHooked = true;
                }
            }
        });

        // Update Bullets
        this.bullets.forEach(bullet => {
            const hitWall = bullet.update(deltaTime, this.map);
            if (!hitWall) {
                this.tanks.forEach(tank => {
                    if (this.currentMode === 'ONLINE') {
                        if (tank === this.myTank) {
                            const dx = bullet.x - tank.x;
                            const dy = bullet.y - tank.y;
                            const dist = Math.sqrt(dx * dx + dy * dy);
                            if (dist < tank.radius + bullet.radius && bullet.color !== tank.color) {
                                this.socket.emit('playerHit', this.myTank.id);
                                bullet.markedForDeletion = true;
                                this.createExplosion(bullet.x, bullet.y, '#fff');
                            }
                        }
                    } else {
                        const dx = bullet.x - tank.x;
                        const dy = bullet.y - tank.y;
                        const dist = Math.sqrt(dx * dx + dy * dy);
                        if (dist < tank.radius + bullet.radius) {
                            if (bullet.color !== tank.color) {
                                tank.takeDamage(10);
                                bullet.markedForDeletion = true;
                                this.createExplosion(bullet.x, bullet.y, '#fff');
                            }
                        }
                    }
                });
            } else {
                this.createExplosion(bullet.x, bullet.y, '#fff');
            }
        });

        // Update Explosions
        this.explosions.forEach(e => {
            e.x += e.vx;
            e.y += e.vy;
            e.life -= 0.05;
        });

        // Check Game Over (Local only)
        if (this.currentMode !== 'ONLINE') {
            if (this.tanks.some(t => t.health <= 0)) {
                const winnerIndex = this.tanks.findIndex(t => t.health > 0);
                const winner = winnerIndex === 0 ? 'Player 1' : (this.currentMode === 'PVP' ? 'Player 2' : 'Computer');
                this.endGame(winner);
            }
        }

        // Update HUD
        if (this.currentMode === 'ONLINE') {
            if (this.myTank) {
                document.getElementById('p1-health').innerText = this.myTank.health;
                document.getElementById('p2-health').innerText = 'Online';
            }
        } else {
            if (this.tanks[0]) document.getElementById('p1-health').innerText = this.tanks[0].health;
            if (this.tanks[1]) document.getElementById('p2-health').innerText = this.tanks[1].health;
        }
    }

    endGame(winner) {
        this.gameState = 'GAMEOVER';
        document.getElementById('game-over').classList.remove('hidden');
        document.getElementById('winner-text').innerText = `${winner} WINS!`;
    }

    draw() {
        this.ctx.fillStyle = 'rgba(5, 5, 5, 0.3)';
        this.ctx.fillRect(0, 0, this.width, this.height);
        this.drawGrid();
        this.map.draw(this.ctx);

        if (this.gameState === 'PLAYING' || this.gameState === 'GAMEOVER') {
            this.tanks.forEach(t => t.draw(this.ctx));
            this.bullets.forEach(b => b.draw(this.ctx));
            this.explosions.forEach(e => {
                this.ctx.globalAlpha = e.life;
                this.ctx.fillStyle = e.color;
                this.ctx.beginPath();
                this.ctx.arc(e.x, e.y, 3, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.globalAlpha = 1.0;
            });
        }
    }

    drawGrid() {
        this.ctx.strokeStyle = '#111';
        this.ctx.lineWidth = 1;
        const gridSize = 64;
        for (let x = 0; x <= this.width; x += gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(x, 0);
            this.ctx.lineTo(x, this.height);
            this.ctx.stroke();
        }
        for (let y = 0; y <= this.height; y += gridSize) {
            this.ctx.beginPath();
            this.ctx.moveTo(0, y);
            this.ctx.lineTo(this.width, y);
            this.ctx.stroke();
        }
    }

    loop(timestamp) {
        const deltaTime = timestamp - this.lastTime;
        this.lastTime = timestamp;
        this.update(deltaTime);
        this.draw();
        requestAnimationFrame((ts) => this.loop(ts));
    }
}

window.onload = () => {
    new Game();
};
