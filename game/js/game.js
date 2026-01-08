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

        this.gameState = 'MENU';
        this.initUI();
        this.loop(0);
    }

    initUI() {
        document.getElementById('btn-pve').addEventListener('click', () => this.startGame('PVE'));
        document.getElementById('btn-pvp').addEventListener('click', () => this.startGame('PVP'));
        document.getElementById('btn-restart').addEventListener('click', () => this.startGame(this.currentMode));
        document.getElementById('btn-menu').addEventListener('click', () => this.showMenu());
    }

    showMenu() {
        this.gameState = 'MENU';
        document.getElementById('main-menu').classList.remove('hidden');
        document.getElementById('game-over').classList.add('hidden');
        document.getElementById('hud').classList.add('hidden');
    }

    startGame(mode) {
        this.currentMode = mode;
        this.gameState = 'PLAYING';
        document.getElementById('main-menu').classList.add('hidden');
        document.getElementById('game-over').classList.add('hidden');
        document.getElementById('hud').classList.remove('hidden');

        this.tanks = [];
        this.bullets = [];
        this.explosions = [];
        this.ais = [];

        // Player 1
        const p1Controls = { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', shoot: 'Space' };
        this.tanks.push(new Tank(100, 100, '#00f3ff', p1Controls, this));

        // Player 2 or AI
        if (mode === 'PVP') {
            const p2Controls = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', shoot: 'Enter' };
            this.tanks.push(new Tank(900, 600, '#ff00ff', p2Controls, this));
        } else {
            // AI Tank
            // AI needs "virtual" keys to map to the controls object output by AIController
            const aiControls = { up: 'up', down: 'down', left: 'left', right: 'right', shoot: 'shoot' };
            const aiTank = new Tank(900, 600, '#ff00ff', aiControls, this);
            this.tanks.push(aiTank);
            this.ais.push(new AIController(aiTank, this.tanks[0], this.map));
        }
    }

    addBullet(bullet) {
        this.bullets.push(bullet);
    }

    createExplosion(x, y, color) {
        // Simple particle effect
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
            // Simulate input for AI tank
            const mockInput = { isKeyDown: (code) => controls[code] === true || (code === 'shoot' && controls.shoot) };
            ai.tank.update(deltaTime, mockInput);
        });

        // Update Tanks
        this.tanks.forEach((tank, index) => {
            if (this.ais.find(ai => ai.tank === tank)) return; // Skip AI tanks here, already updated
            tank.update(deltaTime, this.input);
        });

        // Update Bullets
        this.bullets.forEach(bullet => {
            const hitWall = bullet.update(deltaTime, this.map);
            if (!hitWall) {
                // Check collision with tanks
                this.tanks.forEach(tank => {
                    // Don't hit self immediately (simple check: if far enough or if color diff, but here bullets have owner color)
                    // Simplified: friendly fire ON for simplicity or check distance
                    // Better: check distance from origin.

                    // Basic circle collision for bullets hitting tanks
                    const dx = bullet.x - tank.x;
                    const dy = bullet.y - tank.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < tank.radius + bullet.radius) {
                        if (bullet.color !== tank.color) { // No self damage usually
                            tank.takeDamage(10);
                            bullet.markedForDeletion = true;
                            this.createExplosion(bullet.x, bullet.y, '#fff');
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

        // Check Game Over
        if (this.tanks.some(t => t.health <= 0)) {
            const winnerIndex = this.tanks.findIndex(t => t.health > 0);
            const winner = winnerIndex === 0 ? 'Player 1' : (this.currentMode === 'PVP' ? 'Player 2' : 'Computer');
            this.endGame(winner);
        }

        // Update HUD
        if (this.tanks[0]) document.getElementById('p1-health').innerText = this.tanks[0].health;
        if (this.tanks[1]) document.getElementById('p2-health').innerText = this.tanks[1].health;
    }

    endGame(winner) {
        this.gameState = 'GAMEOVER';
        document.getElementById('game-over').classList.remove('hidden');
        document.getElementById('winner-text').innerText = `${winner} WINS!`;
    }

    draw() {
        // Clear screen with trail effect
        this.ctx.fillStyle = 'rgba(5, 5, 5, 0.3)';
        this.ctx.fillRect(0, 0, this.width, this.height);

        // Draw Grid
        this.drawGrid();

        this.map.draw(this.ctx);

        if (this.gameState === 'PLAYING' || this.gameState === 'GAMEOVER') {
            this.tanks.forEach(t => t.draw(this.ctx));
            this.bullets.forEach(b => b.draw(this.ctx));

            // Draw Explosions
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
