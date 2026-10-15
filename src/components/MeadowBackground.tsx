import { useMemo } from 'react';

const PETAL_COLORS = ['white', 'yellow', 'pink'] as const;
type PetalColor = (typeof PETAL_COLORS)[number];

interface Petal {
  color: PetalColor;
  left: string;
  width: number;
  height: number;
  duration: string;
  delay: string;
  opacity: number;
}

function generatePetals(count: number): Petal[] {
  const petals: Petal[] = [];
  for (let i = 0; i < count; i++) {
    const size = 3 + Math.random() * 15;
    petals.push({
      color: PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)],
      left: `${Math.random() * 100}vw`,
      width: size,
      height: size * 0.75,
      duration: `${8 + Math.random() * 22}s`,
      delay: `${-Math.random() * 30}s`,
      opacity: Number((0.4 + Math.random() * 0.5).toFixed(2)),
    });
  }
  return petals;
}

/**
 * 漫天花瓣草原背景：60 片花瓣落下 + 3 只蝴蝶飞过。
 * 纯装饰，固定定位，pointer-events 穿透。背景图由 CSS（body::before）负责。
 */
export function MeadowBackground() {
  const petals = useMemo(() => generatePetals(60), []);

  return (
    <div className="meadow" aria-hidden="true">
      <div className="meadow__petals">
        {petals.map((petal, i) => (
          <span
            key={i}
            className={`petal petal--${petal.color}`}
            style={{
              left: petal.left,
              width: `${petal.width}px`,
              height: `${petal.height}px`,
              animationDuration: petal.duration,
              animationDelay: petal.delay,
              opacity: petal.opacity,
            }}
          />
        ))}
      </div>

      <div className="meadow__butterflies">
        <span className="butterfly butterfly--b1" />
        <span className="butterfly butterfly--b2" />
        <span className="butterfly butterfly--b3" />
      </div>
    </div>
  );
}
