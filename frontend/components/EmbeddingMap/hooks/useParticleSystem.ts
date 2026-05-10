import { useEffect, useState } from "react";

const PARTICLE_COUNT = 300;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  color: string;
  life: number;
}

export function useParticleSystem(width: number, height: number) {
  const [particles, setParticles] = useState<Particle[]>([]);

  // Initialize particles
  useEffect(() => {
    if (width === 0 || height === 0) return;
    
    const newParticles: Particle[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      newParticles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        size: Math.random() * 2 + 0.5,
        alpha: Math.random() * 0.5 + 0.1,
        color: Math.random() > 0.5 ? '#ffffff' : '#94a3b8',
        life: Math.random() * 1000
      });
    }
    setParticles(newParticles);
  }, [width, height]);

  // Update particles
  useEffect(() => {
    const interval = setInterval(() => {
      setParticles(prev => prev.map(p => ({
        ...p,
        x: p.x + p.vx,
        y: p.y + p.vy,
        life: p.life - 1,
        alpha: p.life > 0 ? p.alpha * (p.life / 1000) : 0
      })).filter(p => p.life > 0));
    }, 50);
    return () => clearInterval(interval);
  }, []);

  return particles;
}
