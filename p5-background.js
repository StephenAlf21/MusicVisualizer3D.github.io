/*
  p5-background.js
  A uniform p5.js graphical background for all pages.
  Features floating particles in the theme colors (red, blue, yellow)
  that connect when close to each other.
*/

let particles = [];
const particleColors = [];

function setup() {
    let canvas = createCanvas(windowWidth, windowHeight);
    canvas.parent('p5-canvas-container');
    
    // Define the color palette for particles from the CSS variables
    // Note: p5.js color() can't read CSS variables directly, so we hardcode them here.
    // These should match the values in style.css
    const red = color(229, 62, 62);
    const blue = color(66, 153, 225);
    const yellow = color(246, 224, 94);
    particleColors.push(red, blue, yellow);

    let particleCount = window.innerWidth < 768 ? 40 : 80;
    for (let i = 0; i < particleCount; i++) {
        particles.push(new Particle());
    }
}

function draw() {
    // A subtle transparent background to create a trail effect
    background(18, 18, 18, 25); 

    for (let i = 0; i < particles.length; i++) {
        particles[i].createParticle();
        particles[i].moveParticle();
        particles[i].joinParticles(particles.slice(i));
    }
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}

class Particle {
    constructor() {
        this.x = random(0, width);
        this.y = random(0, height);
        this.r = random(1, 4);
        this.xSpeed = random(-0.5, 0.5);
        this.ySpeed = random(-0.5, 0.5);
        // Assign a random color from our palette
        this.color = random(particleColors);
    }

    createParticle() {
        noStroke();
        fill(this.color);
        circle(this.x, this.y, this.r);
    }

    moveParticle() {
        if (this.x < 0 || this.x > width) this.xSpeed *= -1;
        if (this.y < 0 || this.y > height) this.ySpeed *= -1;
        this.x += this.xSpeed;
        this.y += this.ySpeed;
    }

    joinParticles(otherParticles) {
        otherParticles.forEach(p => {
            let d = dist(this.x, this.y, p.x, p.y);
            if (d < 100) {
                // Make the stroke color a mix of the two particles' colors
                let strokeColor = lerpColor(this.color, p.color, 0.5);
                // Set opacity based on distance
                let alpha = map(d, 0, 100, 150, 0);
                strokeColor.setAlpha(alpha);
                stroke(strokeColor);
                line(this.x, this.y, p.x, p.y);
            }
        });
    }
}
