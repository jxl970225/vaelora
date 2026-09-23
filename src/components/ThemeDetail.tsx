import type { ThemeImage } from '../../shared/types';

interface ThemeDetailProps {
  themeName: string;
  items: ThemeImage[];
  isAdmin: boolean;
  loading: boolean;
  onBack: () => void;
  onDelete: (item: ThemeImage) => void;
}

/** 二级页：某个主题目录下的全部图片。 */
export function ThemeDetail({
  themeName,
  items,
  isAdmin,
  loading,
  onBack,
  onDelete,
}: ThemeDetailProps) {
  return (
    <>
      <div className="detailbar">
        <button type="button" className="detailbar__back" onClick={onBack} aria-label="返回">
          ←
        </button>
        <h2 className="detailbar__title">{themeName}</h2>
        <span className="detailbar__count">{items.length}</span>
      </div>

      {loading ? (
        <p className="state">加载中…</p>
      ) : items.length === 0 ? (
        <p className="state">这个主题还没有图片。</p>
      ) : (
        <ul className="grid">
          {items.map((item) => (
            <li key={item.key} className="card">
              <div
                className="card__frame"
                // 预留宽高比，避免图片加载完成时页面跳动。
                // 宽高来自 R2 对象的 customMetadata，缺了就退回正方形。
                style={
                  item.width && item.height
                    ? { aspectRatio: `${item.width} / ${item.height}` }
                    : undefined
                }
              >
                <img
                  className="card__img"
                  src={item.url}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
              </div>

              {isAdmin && (
                <button
                  type="button"
                  className="card__delete"
                  aria-label="删除这张图片"
                  onClick={() => onDelete(item)}
                >
                  ✕
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
