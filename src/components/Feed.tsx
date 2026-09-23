import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchFeed, fetchThemeImages } from '../lib/api';
import type { FeedSection, GalleryItem } from '../../shared/types';

interface FeedProps {
  isAdmin: boolean;
  /** 上传完成后由父组件递增，触发整页重新拉取 */
  reloadSignal: number;
  onDelete: (item: GalleryItem) => void;
  onError: (message: string) => void;
}

/**
 * 首页：按主题分组依次铺开图片。
 *
 * 图片元数据一次性拿全（一次请求），但 <img> 带 loading="lazy"，
 * 浏览器只下载进入视口附近的图 —— 所以 DOM 里挂着几百个 img 也不会
 * 一次性拉几百个文件。
 */
export function Feed({ isAdmin, reloadSignal, onDelete, onError }: FeedProps) {
  const [sections, setSections] = useState<FeedSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMoreFor, setLoadingMoreFor] = useState<string | null>(null);

  // 用 ref 存 onError，避免父组件传入新函数时把 load 的引用也换掉，
  // 那会导致 useEffect 反复触发、无限重新拉取
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSections(await fetchFeed());
    } catch (e) {
      onErrorRef.current(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadSignal]);

  async function loadMore(section: FeedSection) {
    if (!section.nextCursor || loadingMoreFor) return;
    setLoadingMoreFor(section.theme);
    try {
      const page = await fetchThemeImages(section.theme, section.nextCursor);
      setSections((prev) =>
        prev.map((s) =>
          s.theme === section.theme
            ? { ...s, items: [...s.items, ...page.items], nextCursor: page.nextCursor }
            : s
        )
      );
    } catch (e) {
      onErrorRef.current(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoadingMoreFor(null);
    }
  }

  if (loading) return <p className="state">加载中…</p>;
  if (sections.length === 0) return <p className="state">还没有图片。</p>;

  return (
    <div className="feed">
      {sections.map((section) => (
        <section key={section.theme} className="feed__section">
          <div className="feed__head">
            <h2 className="feed__title">{section.name}</h2>
            <span className="feed__count">{section.count}</span>
          </div>

          <ul className="grid">
            {section.items.map((item) => (
              <li key={item.id} className="card">
                <div
                  className="card__frame"
                  // 预留宽高比，避免图片加载完成时页面跳动
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

          {section.nextCursor && (
            <div className="more">
              <button
                type="button"
                onClick={() => void loadMore(section)}
                disabled={loadingMoreFor === section.theme}
              >
                {loadingMoreFor === section.theme ? '加载中…' : '加载更多'}
              </button>
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
