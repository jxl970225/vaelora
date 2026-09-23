import { useCallback, useEffect, useRef, useState } from 'react';
import { BottomBar } from './components/BottomBar';
import { Feed } from './components/Feed';
import { LoginModal } from './components/LoginModal';
import { ThemePicker } from './components/ThemePicker';
import { ThemeDetail } from './components/ThemeDetail';
import { Starfield } from './components/Starfield';
import { deleteImage, fetchThemeImages } from './lib/api';
import { uploadImage } from './lib/upload';
import { goHome, useRoute } from './lib/route';
import { themeName } from '../shared/themes';
import type { GalleryItem } from '../shared/types';

interface Job {
  key: string;
  name: string;
  previewUrl: string;
  progress: number;
  status: 'queued' | 'uploading' | 'done' | 'error';
  error?: string;
}

export default function App() {
  const route = useRoute();

  // 凭证只活在内存里：刷新页面即失效，这是刻意的。
  // 注意这不是"更安全"—— 前端存哪都不构成安全边界，服务端每次写操作都会验。
  const [token, setToken] = useState<string | null>(null);
  const isAdmin = token !== null;

  const [error, setError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);

  const [showLogin, setShowLogin] = useState(false);
  const [showPicker, setShowPicker] = useState(false);

  // 首页信息流的数据由 Feed 自己管，这里只用一个计数器通知它重新拉取
  const [feedReload, setFeedReload] = useState(0);

  // 二级页仍保留（可通过 #/theme/xxx 直接访问），数据在这里管
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // 用 ref 而不是 state：file input 的 onChange 触发时读到的必须是最新值
  const pendingThemeRef = useRef<string | null>(null);

  const loadTheme = useCallback(async (theme: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      const page = await fetchThemeImages(theme, null);
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载图片失败');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (route.name === 'theme') void loadTheme(route.theme);
  }, [route, loadTheme]);

  const loadMore = useCallback(async () => {
    if (route.name !== 'theme' || !cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchThemeImages(route.theme, cursor);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoadingMore(false);
    }
  }, [route, cursor, loadingMore]);

  // ── 上传 ──────────────────────────────────────────
  const patchJob = (key: string, patch: Partial<Job>) => {
    setJobs((prev) => prev.map((job) => (job.key === key ? { ...job, ...patch } : job)));
  };

  function handleUploadClick() {
    if (route.name === 'theme') {
      // 二级页：自动归属当前主题
      pendingThemeRef.current = route.theme;
      fileInputRef.current?.click();
    } else {
      // 首页：先选主题
      setShowPicker(true);
    }
  }

  function handlePickTheme(theme: string) {
    setShowPicker(false);
    pendingThemeRef.current = theme;
    // 仍在这次点击的手势上下文内，file input 才打得开
    fileInputRef.current?.click();
  }

  async function handleFiles(files: FileList | null) {
    const theme = pendingThemeRef.current;
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!files?.length || !token || !theme) return;

    const picked = Array.from(files);
    const queued: Job[] = picked.map((file, index) => ({
      key: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      previewUrl: '',
      progress: 0,
      status: 'queued',
    }));
    setJobs((prev) => [...prev, ...queued]);

    // 串行上传：并行会占满上行带宽，弱网下反而更慢
    for (let i = 0; i < picked.length; i++) {
      const job = queued[i];
      patchJob(job.key, { status: 'uploading' });
      try {
        await uploadImage(picked[i], {
          theme,
          token,
          onPreview: (url) => patchJob(job.key, { previewUrl: url }),
          onProgress: (pct) => patchJob(job.key, { progress: pct }),
        });
        patchJob(job.key, { status: 'done', progress: 1 });
      } catch (e) {
        patchJob(job.key, {
          status: 'error',
          error: e instanceof Error ? e.message : '上传失败',
        });
      }
    }

    window.setTimeout(() => setJobs((prev) => prev.filter((job) => job.status !== 'done')), 1200);

    // 上传完重新拉取当前视图的数据
    if (route.name === 'theme') await loadTheme(route.theme);
    else setFeedReload((n) => n + 1);
  }

  // ── 删除 ──────────────────────────────────────────
  async function handleDelete(item: GalleryItem) {
    if (!token) return;
    if (!window.confirm('删除这张图片？此操作不可撤销。')) return;
    try {
      await deleteImage(item.id, token);
      setItems((prev) => prev.filter((p) => p.id !== item.id));
      setFeedReload((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  }

  return (
    <>
      <Starfield />

      <div className="app">
        <header className="header">
          <h1 onClick={goHome} role="presentation">
            Vaelora
          </h1>
        </header>

        {error && (
          <div className="banner banner--error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="关闭">
              ✕
            </button>
          </div>
        )}

        <main>
          {route.name === 'home' ? (
            <Feed
              isAdmin={isAdmin}
              reloadSignal={feedReload}
              onDelete={(item) => void handleDelete(item)}
              onError={setError}
            />
          ) : (
            <ThemeDetail
              themeName={themeName(route.theme)}
              items={items}
              isAdmin={isAdmin}
              loading={detailLoading}
              loadingMore={loadingMore}
              hasMore={cursor !== null}
              onBack={goHome}
              onLoadMore={() => void loadMore()}
              onDelete={(item) => void handleDelete(item)}
            />
          )}
        </main>

        {jobs.length > 0 && (
          <ul className="jobs">
            {jobs.map((job) => (
              <li key={job.key} className={`job job--${job.status}`}>
                <div
                  className="job__thumb"
                  style={
                    job.previewUrl ? { backgroundImage: `url(${job.previewUrl})` } : undefined
                  }
                />
                <div className="job__body">
                  <span className="job__name">{job.name}</span>
                  {job.status === 'error' ? (
                    <span className="job__error">{job.error}</span>
                  ) : (
                    <div className="job__bar">
                      <div
                        className="job__fill"
                        style={{ width: `${Math.round(job.progress * 100)}%` }}
                      />
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          hidden
          onChange={(e) => void handleFiles(e.target.files)}
        />

        <BottomBar
          isAdmin={isAdmin}
          onRequestLogin={() => setShowLogin(true)}
          onUploadClick={handleUploadClick}
          onLogout={() => setToken(null)}
        />

        {showLogin && (
          <LoginModal
            onSuccess={(t) => {
              setToken(t);
              setShowLogin(false);
            }}
            onClose={() => setShowLogin(false)}
          />
        )}

        {showPicker && <ThemePicker onPick={handlePickTheme} onClose={() => setShowPicker(false)} />}
      </div>
    </>
  );
}
