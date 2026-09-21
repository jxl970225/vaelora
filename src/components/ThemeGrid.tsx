import type { ThemeSummary } from '../../shared/types';

interface ThemeGridProps {
  themes: ThemeSummary[];
  loading: boolean;
  onOpen: (themeId: string) => void;
}

/** 首页：八个主题栏位，每个用该主题最新一张图作封面。 */
export function ThemeGrid({ themes, loading, onOpen }: ThemeGridProps) {
  if (loading) return <p className="state">加载中…</p>;

  return (
    <ul className="themes">
      {themes.map((theme) => (
        <li key={theme.id}>
          <button type="button" className="theme" onClick={() => onOpen(theme.id)}>
            <div className="theme__frame">
              {theme.cover ? (
                <img
                  className="theme__img"
                  src={theme.cover.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <span className="theme__empty">暂无图片</span>
              )}
            </div>
            <div className="theme__meta">
              <span className="theme__name">{theme.name}</span>
              <span className="theme__count">{theme.count}</span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
