import { useEffect, useState } from 'react';

export type Route = { name: 'home' } | { name: 'theme'; theme: string };

function parse(hash: string): Route {
  const match = /^#\/theme\/([A-Za-z0-9_-]+)$/.exec(hash);
  return match ? { name: 'theme', theme: match[1] } : { name: 'home' };
}

/**
 * 只有两级页面，用 hash 路由就够了 —— 刷新和浏览器后退都能正常工作，
 * 也不需要引入 React Router。
 *
 * 首页现在直接铺开图片、不再放主题入口，但 #/theme/xxx 这个路由保留着，
 * 直接访问该地址仍然可用。
 */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}

export function goHome(): void {
  window.location.hash = '';
}
