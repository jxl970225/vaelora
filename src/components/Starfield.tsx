import { useEffect, useRef } from 'react';

/** 星星配色：白 / 淡蓝 / 淡黄 */
const PALETTE = ['#ffffff', '#cfe0ff', '#fff3c4'];

interface Star {
  x: number;
  y: number;
  r: number;
  baseA: number;
  tw: number;
  spd: number;
  c: string;
}

interface Meteor {
  x: number;
  y: number;
  vx: number;
  vy: number;
  len: number;
  life: number;
}

/**
 * 动态星空背景。纯装饰，固定在视口最底层。
 *
 * 深空渐变和星云由 CSS 负责（body::before），这里只画会动的部分：
 * 闪烁的星星 + 随机划过的流星。
 */
export function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const maybeCanvas = canvasRef.current;
    if (!maybeCanvas) return;
    // 先收窄再赋给新 const：函数声明里的引用不会沿用 maybe 的收窄结果
    const canvas = maybeCanvas;
    const context2d = canvas.getContext('2d');
    if (!context2d) return;
    const ctx = context2d;

    // Retina 下清晰，但封顶 2 倍——再高只是白烧 GPU
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let width = 0;
    let height = 0;
    let stars: Star[] = [];
    const meteors: Meteor[] = [];
    let rafId = 0;
    let lastMeteor = 0;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function buildStars() {
      // 按屏幕面积算密度，手机和 iPad 各自合适
      const count = Math.floor((width * height) / 3200);
      stars = [];
      for (let i = 0; i < count; i++) {
        stars.push({
          x: Math.random() * width,
          y: Math.random() * height,
          r: 0.3 + Math.random() * 1.4,
          baseA: 0.35 + Math.random() * 0.55,
          tw: Math.random() * Math.PI * 2,
          spd: 0.6 + Math.random() * 1.8,
          c: PALETTE[(Math.random() * PALETTE.length) | 0],
        });
      }
    }

    function resize() {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      buildStars();
      // 减弱动效模式下不跑循环，改尺寸后需要重画一帧
      if (reducedMotion) drawFrame(1000);
    }

    function spawnMeteor(now: number) {
      meteors.push({
        x: width * (0.25 + Math.random() * 0.75), // 右半屏起
        y: height * (0.05 + Math.random() * 0.35), // 上半屏起
        vx: -(3 + Math.random() * 3), // 向左下飞
        vy: 1.6 + Math.random() * 1.4,
        len: 80 + Math.random() * 120,
        life: 1,
      });
      lastMeteor = now;
    }

    function drawFrame(now: number) {
      ctx.clearRect(0, 0, width, height);

      // 星星：亮度按正弦闪烁
      const t = now * 0.001;
      for (const star of stars) {
        ctx.globalAlpha = star.baseA * (0.55 + 0.45 * Math.sin(t * star.spd + star.tw));
        ctx.fillStyle = star.c;
        ctx.beginPath();
        ctx.arc(star.x, star.y, star.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // 流星：渐变拖尾，生命耗尽或飞出画面就移除
      for (let i = meteors.length - 1; i >= 0; i--) {
        const meteor = meteors[i];
        const tailX = meteor.x - meteor.vx * (meteor.len / 6);
        const tailY = meteor.y - meteor.vy * (meteor.len / 6);

        const gradient = ctx.createLinearGradient(meteor.x, meteor.y, tailX, tailY);
        gradient.addColorStop(0, `rgba(255,255,255,${0.9 * meteor.life})`);
        gradient.addColorStop(1, 'rgba(255,255,255,0)');

        ctx.strokeStyle = gradient;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(meteor.x, meteor.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();

        meteor.x += meteor.vx;
        meteor.y += meteor.vy;
        meteor.life -= 0.012;
        if (meteor.life <= 0 || meteor.x < -200 || meteor.y > height + 200) {
          meteors.splice(i, 1);
        }
      }
    }

    function loop(now: number) {
      drawFrame(now);
      if (now - lastMeteor > 3000 + Math.random() * 4000) spawnMeteor(now);
      rafId = requestAnimationFrame(loop);
    }

    window.addEventListener('resize', resize);
    resize();

    if (reducedMotion) {
      // 用户要求减弱动效：画一帧静态星空，不跑循环
      drawFrame(1000);
    } else {
      rafId = requestAnimationFrame(loop);
    }

    // StrictMode 下 effect 会挂载两次，不清理就会有两个循环同时跑
    return () => {
      window.removeEventListener('resize', resize);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, []);

  return <canvas ref={canvasRef} className="starfield" aria-hidden="true" />;
}
