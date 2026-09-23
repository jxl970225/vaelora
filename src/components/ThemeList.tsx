import type { ThemeSummary } from '../../shared/types';

interface ThemeListProps {
  themes: ThemeSummary[];
  loading: boolean;
  onOpen: (index: number) => void;
}

/**
 * 首页：一级图片（主题封面），纵向一列。
 *
 * 没有封面的主题在服务端就被过滤掉了，所以前端不需要处理"这个主题没图"，
 * 也就不需要占位框。
 */
export function ThemeList({ themes, loading, onOpen }: ThemeListProps) {
  if (loading) return <p className="state">加载中…</p>;
  if (themes.length === 0) return <p className="state">还没有图片。</p>;

  return (
    <ul className="covers">
      {themes.map((theme) => (
        <li key={theme.index}>
          <button
            type="button"
            className="cover"
            onClick={() => onOpen(theme.index)}
            aria-label={theme.name}
          >
            <img className="cover__img" src={theme.coverUrl} alt="" decoding="async" />
            <span className="cover__name">{theme.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
