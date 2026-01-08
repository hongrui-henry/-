class Bullet {
    constructor(x, y, angle, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.speed = 0.5; // Pixels per ms
        this.vx = Math.cos(angle) * this.speed;
        this.vy = Math.sin(angle) * this.speed;
        this.radius = 3;
        this.markedForDeletion = false;
    }

    update(deltaTime, map) {
        this.x += this.vx * deltaTime;
        this.y += this.vy * deltaTime;

        // Check Map Collision
        if (map.checkCollision({ x: this.x, y: this.y, radius: this.radius })) {
            this.markedForDeletion = true;
            return true; // Hit wall
        }

        return false;
    }

    draw(ctx) {
        ctx.save();
        ctx.shadowBlur = 10;
        ctx.shadowColor = this.color;
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}
