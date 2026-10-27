// Pooled point-sprite particle system: dust, coin sparkle, crash, trails.
import * as THREE from 'three';

interface P {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
  color: THREE.Color;
}

export class ParticleSystem {
  private max: number;
  private particles: P[] = [];
  private geo = new THREE.BufferGeometry();
  private positions: Float32Array;
  private colors: Float32Array;
  private sizes: Float32Array;
  points: THREE.Points;

  constructor(max = 400) {
    this.max = max;
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.sizes = new Float32Array(max);
    for (let i = 0; i < max; i++) {
      this.particles.push({
        active: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0, maxLife: 1, size: 1,
        color: new THREE.Color(),
      });
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1));
    const mat = new THREE.PointsMaterial({
      size: 0.14,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
  }

  emit(pos: THREE.Vector3, count: number, color: number, speed = 2, life = 0.5, spread = 1) {
    let emitted = 0;
    for (const p of this.particles) {
      if (p.active) continue;
      p.active = true;
      p.pos.copy(pos);
      p.vel.set(
        (Math.random() - 0.5) * speed * spread,
        Math.random() * speed,
        (Math.random() - 0.5) * speed * spread
      );
      p.maxLife = p.life = life * (0.6 + Math.random() * 0.8);
      p.color.setHex(color);
      if (++emitted >= count) break;
    }
  }

  update(dt: number, worldDz: number) {
    let i = 0;
    for (const p of this.particles) {
      if (p.active) {
        p.life -= dt;
        if (p.life <= 0) p.active = false;
        else {
          p.vel.y -= 4 * dt;
          p.pos.addScaledVector(p.vel, dt);
          p.pos.z += worldDz; // drift with world
        }
      }
      if (p.active) {
        this.positions[i * 3] = p.pos.x;
        this.positions[i * 3 + 1] = p.pos.y;
        this.positions[i * 3 + 2] = p.pos.z;
        const a = p.life / p.maxLife;
        this.colors[i * 3] = p.color.r * a;
        this.colors[i * 3 + 1] = p.color.g * a;
        this.colors[i * 3 + 2] = p.color.b * a;
      } else {
        this.positions[i * 3 + 1] = -999;
      }
      i++;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
