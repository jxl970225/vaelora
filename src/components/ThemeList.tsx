import type { ThemeSummary } from '../../shared/types';

interface ThemeListProps {
  themes: ThemeSummary[];
  loading: boolean;
  isAdmin: boolean;
  /** 点封面进入该位置的二级页 */
  onOpen: (index: number) => void;
  /** 管理员点空位上传按钮 */
  onUploadToSlot: (index: number) => void;
}

/**
 * 首页：8 个固定位置的一级图片（封面），纵向一列。
 *
 * 浏览模式：只展示有封面的位置（纯图，无名字无编号），空位跳过。
 * 管理员上传模式：8 个位置都展示，空位显示上传按钮用于补位。
 */
export function ThemeList({ themes, loading, isAdmin, onOpen, onUploadToSlot }: ThemeListProps) {
  if (loading) return <p className="state">Loading…</p>;

  const visible = isAdmin ? themes : themes.filter((t) => t.coverUrl !== null);
  if (visible.length === 0) {
    return isAdmin ? null : <p className="state">No images yet.</p>;
  }

  return (
    <ul className="covers">
      {visible.map((theme) => (
        <li key={theme.index}>
          {theme.coverUrl ? (
            <button
              type="button"
              className="cover"
              onClick={() => onOpen(theme.index)}
              aria-label="Open collection"
            >
              <img className="cover__img" src={theme.coverUrl} alt="" decoding="async" />
            </button>
          ) : (
            <button
              type="button"
              className="cover-slot"
              onClick={() => onUploadToSlot(theme.index)}
              aria-label="Upload cover"
            >
              <span className="cover-slot__plus">+</span>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
