class AIController {
    constructor(tank, target, map) {
        this.tank = tank;
        this.target = target;
        this.map = map;

        // AI State
        this.state = 'CHASE'; // CHASE, SCATTER, EVADE
        this.lastStateChange = 0;
        this.stateDuration = 2000;

        // Random Moves
        this.randomMoveDir = null;
        this.randomMoveTime = 0;

        // Stuck Detection
        this.lastPos = { x: 0, y: 0 };
        this.stuckTimer = 0;
        this.isStuck = false;
        this.stuckResolveTime = 0;
    }

    update(deltaTime) {
        const now = Date.now();
        const controls = { up: false, down: false, left: false, right: false, shoot: false };

        // Stuck Detection
        const moveDist = Math.sqrt(Math.pow(this.tank.x - this.lastPos.x, 2) + Math.pow(this.tank.y - this.lastPos.y, 2));
        if (moveDist < 0.5 && (this.tank.controls.up || this.tank.controls.down)) {
            this.stuckTimer += deltaTime;
        } else {
            this.stuckTimer = Math.max(0, this.stuckTimer - deltaTime);
        }
        this.lastPos = { x: this.tank.x, y: this.tank.y };

        if (this.stuckTimer > 500) {
            this.isStuck = true;
            this.stuckResolveTime = 1000;
            this.stuckTimer = 0;
            // Pick a random direction to unstuck
            this.randomMoveDir = Math.random() > 0.5 ? 'left' : 'right';
        }

        if (this.isStuck) {
            this.stuckResolveTime -= deltaTime;
            if (this.stuckResolveTime <= 0) {
                this.isStuck = false;
            } else {
                // Reverse and turn
                controls.down = true;
                controls[this.randomMoveDir] = true;
                return controls;
            }
        }

        // State Machine
        if (now - this.lastStateChange > this.stateDuration) {
            this.lastStateChange = now;
            const rand = Math.random();
            if (rand < 0.7) this.state = 'CHASE';
            else if (rand < 0.9) this.state = 'SCATTER'; // Random move
            else this.state = 'IDLE'; // Small pause

            // Randomize duration
            this.stateDuration = 1000 + Math.random() * 2000;

            if (this.state === 'SCATTER') {
                this.randomMoveDir = Math.random() > 0.5 ? 'left' : 'right';
            }
        }

        // Action based on state
        if (this.state === 'SCATTER') {
            controls.up = true;
            if (this.randomMoveDir === 'left') controls.left = true;
            else controls.right = true;

            // Still shoot if lucky
            if (Math.random() < 0.05) controls.shoot = true;

        } else if (this.state === 'CHASE') {
            // 1. Aim at player
            const dx = this.target.x - this.tank.x;
            const dy = this.target.y - this.tank.y;
            const targetAngle = Math.atan2(dy, dx);

            // Normalize angles
            let diff = targetAngle - this.tank.rotation;
            while (diff < -Math.PI) diff += Math.PI * 2;
            while (diff > Math.PI) diff -= Math.PI * 2;

            if (Math.abs(diff) > 0.1) {
                if (diff > 0) controls.right = true;
                else controls.left = true;
            } else {
                controls.shoot = true;
            }

            // Movement
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance > 300) {
                controls.up = true;
            } else if (distance < 150) {
                controls.down = true;
            }
        }

        return controls;
    }
}
