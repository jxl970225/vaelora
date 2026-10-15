import type { ThemeImage } from '../../shared/types';

interface ThemeDetailProps {
  items: ThemeImage[];
  description: string | null;
  isAdmin: boolean;
  loading: boolean;
  onBack: () => void;
  onDelete: (item: ThemeImage) => void;
  /** 管理员补位上传：上传到指定序号 */
  onUploadToSlot: (seq: number) => void;
}

/** 二级页：某个位置目录下的全部图片，按序号排列。 */
export function ThemeDetail({
  items,
  description,
  isAdmin,
  loading,
  onBack,
  onDelete,
  onUploadToSlot,
}: ThemeDetailProps) {
  // 槽位范围：1 到当前最大序号 + 1（末尾始终留一个"新增"槽）。
  // 管理员模式下，中间缺号的位置显示上传按钮，用于补位。
  const maxSeq = items.reduce((m, item) => Math.max(m, item.seq), 0);
  const bySeq = new Map(items.map((item) => [item.seq, item]));
  const slotCount = isAdmin ? maxSeq + 1 : 0;

  const slots: { seq: number; item: ThemeImage | null }[] = [];
  for (let seq = 1; seq <= slotCount; seq++) {
    slots.push({ seq, item: bySeq.get(seq) ?? null });
  }

  return (
    <>
      <div className="detailbar">
        <button type="button" className="detailbar__back" onClick={onBack} aria-label="Back">
          ←
        </button>
        <span className="detailbar__count">{items.length}</span>
      </div>

      {loading ? (
        <p className="state">Loading…</p>
      ) : items.length === 0 && !isAdmin ? (
        <p className="state">No images in this theme yet.</p>
      ) : (
        <ul className="grid">
          {isAdmin
            ? slots.map(({ seq, item }) => (
                <li key={seq} className="card">
                  {item ? (
                    <>
                      <div
                        className="card__frame"
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
                      <button
                        type="button"
                        className="card__delete"
                        aria-label="Delete this image"
                        onClick={() => onDelete(item)}
                      >
                        ✕
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="card__slot"
                      onClick={() => onUploadToSlot(seq)}
                      aria-label={`Upload image at position ${seq}`}
                    >
                      <span className="card__slot-plus">+</span>
                      <span className="card__slot-seq">{seq}</span>
                    </button>
                  )}
                </li>
              ))
            : items.map((item) => (
                <li key={item.key} className="card">
                  <div
                    className="card__frame"
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
                </li>
              ))}
        </ul>
      )}

      {description && <p className="detail__desc">{description}</p>}
    </>
  );
}
