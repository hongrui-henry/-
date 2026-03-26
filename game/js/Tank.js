class Tank {
    constructor(x, y, color, controls, game) {
        this.game = game;
        this.x = x;
        this.y = y;
        this.color = color;
        this.width = 40;
        this.height = 40;
        this.rotation = 0; // In radians
        this.speed = 0.2; // Pixels per ms
        this.rotationSpeed = 0.003; // Radians per ms
        this.controls = controls; // { up, down, left, right, shoot, dash }
        this.lastShotTime = 0;
        this.shootCooldown = 500; // ms
        this.health = 100;
        this.radius = 20; // For collision

        // Dash
        this.isDashing = false;
        this.dashCooldown = 1500; // Reduced cooldown for better flow
        this.lastDashTime = 0;
        this.dashSpeedMultiplier = 3.5; // Slightly faster
        this.dashDuration = 250; // Slightly longer
    }

    update(deltaTime, input) {
        if (this.health <= 0) return;

        // Rotation
        if (input.isKeyDown(this.controls.left)) {
            this.rotation -= this.rotationSpeed * deltaTime;
        }
        if (input.isKeyDown(this.controls.right)) {
            this.rotation += this.rotationSpeed * deltaTime;
        }

        // Dash Logic
        if (this.controls.dash && input.isKeyDown(this.controls.dash) && Date.now() - this.lastDashTime > this.dashCooldown) {
            this.isDashing = true;
            this.lastDashTime = Date.now();
            setTimeout(() => this.isDashing = false, this.dashDuration);
        }

        // Movement
        const currentSpeed = this.isDashing ? this.speed * this.dashSpeedMultiplier : this.speed;

        const velocity = { x: 0, y: 0 };
        if (input.isKeyDown(this.controls.up)) {
            velocity.x = Math.cos(this.rotation) * currentSpeed * deltaTime;
            velocity.y = Math.sin(this.rotation) * currentSpeed * deltaTime;
        }
        if (input.isKeyDown(this.controls.down)) {
            velocity.x = -Math.cos(this.rotation) * currentSpeed * deltaTime;
            velocity.y = -Math.sin(this.rotation) * currentSpeed * deltaTime;
        }

        // Proposed new position
        const newX = this.x + velocity.x;
        const newY = this.y + velocity.y;

        // Check Wall Collisions
        if (!this.game.map.checkCollision({
            x: newX, y: newY, width: this.width, height: this.height, radius: this.radius
        })) {
            this.x = newX;
            this.y = newY;
        } else {
            // Slide along walls (simplified: try moving only one axis)
            if (!this.game.map.checkCollision({
                x: newX, y: this.y, width: this.width, height: this.height, radius: this.radius
            })) {
                this.x = newX;
            } else if (!this.game.map.checkCollision({
                x: this.x, y: newY, width: this.width, height: this.height, radius: this.radius
            })) {
                this.y = newY;
            }
        }

        // Screen Boundaries
        this.x = Math.max(this.radius, Math.min(this.game.width - this.radius, this.x));
        this.y = Math.max(this.radius, Math.min(this.game.height - this.radius, this.y));

        // Shooting
        if (input.isKeyDown(this.controls.shoot)) {
            this.shoot(Date.now());
        }
    }

    shoot(currentTime) {
        if (currentTime - this.lastShotTime > this.shootCooldown) {
            const nozzleLength = 30;
            const bulletX = this.x + Math.cos(this.rotation) * nozzleLength;
            const bulletY = this.y + Math.sin(this.rotation) * nozzleLength;

            this.game.addBullet(new Bullet(bulletX, bulletY, this.rotation, this.color));
            this.lastShotTime = currentTime;
        }
    }

    draw(ctx) {
        if (this.health <= 0) return;

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.rotation);

        // Dash Trail Effect
        if (this.isDashing) {
            ctx.shadowBlur = 40;
            ctx.shadowColor = '#fff';
        }

        // Body
        ctx.shadowBlur = 15;
        ctx.shadowColor = this.color;

        ctx.strokeStyle = this.color;
        ctx.lineWidth = 2;
        ctx.fillStyle = '#000';

        ctx.fillRect(-15, -15, 30, 30);
        ctx.strokeRect(-15, -15, 30, 30);

        // Turret (Nozzle)
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(25, 0);
        ctx.stroke();

        // Direction Indicator
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(0, 0, 5, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();

        // Draw Dash Cooldown Bar
        if (this.controls.dash) { // Only draw if tank has dash control
            const now = Date.now();
            const timeSinceDash = now - this.lastDashTime;
            const cooldownRatio = Math.min(timeSinceDash / this.dashCooldown, 1);

            if (cooldownRatio < 1) {
                ctx.save();
                ctx.translate(this.x, this.y);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
                ctx.fillRect(-20, 25, 40, 4);

                ctx.fillStyle = this.isDashing ? '#fff' : this.color;
                ctx.fillRect(-20, 25, 40 * cooldownRatio, 4);
                ctx.restore();
            }
        }
    }

    takeDamage(amount) {
        this.health -= amount;
        if (this.health <= 0) {
            this.game.createExplosion(this.x, this.y, this.color);
        }
    }

    getBounds() {
        return { x: this.x - 15, y: this.y - 15, width: 30, height: 30 };
    }
}
