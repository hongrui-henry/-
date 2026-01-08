class Map {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.walls = [];
        this.generateMap();
    }

    generateMap() {
        // Create some simple walls
        // Outer boundaries are handled by game logic, but we can add inner walls
        this.walls = [
            { x: 200, y: 200, w: 50, h: 300 },
            { x: 800, y: 200, w: 50, h: 300 },
            { x: 400, y: 350, w: 250, h: 50 },
            { x: 100, y: 600, w: 200, h: 50 },
            { x: 700, y: 100, w: 200, h: 50 }
        ];
    }

    checkCollision(circleOrRect) {
        // Simplified circle-AABB or point-AABB collision
        // entity: { x, y, radius } or { x, y, width, height } (center based for tanks? actually Tanks are center based x,y)

        // Let's assume input is coordinate (x,y) and radius/size
        // Tanks pass x,y as center.

        const r = circleOrRect.radius || 1;

        for (const wall of this.walls) {
            // Check if circle (x,y,r) overlaps with rectangle (wall.x, wall.y, wall.w, wall.h)
            // Find closest point on rectangle to circle center
            const testX = Math.max(wall.x, Math.min(circleOrRect.x, wall.x + wall.w));
            const testY = Math.max(wall.y, Math.min(circleOrRect.y, wall.y + wall.h));

            const distX = circleOrRect.x - testX;
            const distY = circleOrRect.y - testY;
            const distance = Math.sqrt((distX * distX) + (distY * distY));

            if (distance <= r) {
                return true;
            }
        }
        return false;
    }

    draw(ctx) {
        ctx.save();
        ctx.fillStyle = '#1a1a1a';
        ctx.strokeStyle = '#00f3ff';
        ctx.lineWidth = 2;
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#00f3ff';

        for (const wall of this.walls) {
            ctx.fillRect(wall.x, wall.y, wall.w, wall.h);
            ctx.strokeRect(wall.x, wall.y, wall.w, wall.h);
        }
        ctx.restore();
    }
}
