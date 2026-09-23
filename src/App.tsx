import { useCallback, useEffect, useRef, useState } from 'react';
import { BottomBar } from './components/BottomBar';
import { LoginModal } from './components/LoginModal';
import { ThemePicker } from './components/ThemePicker';
import { ThemeDetail } from './components/ThemeDetail';
import { ThemeList } from './components/ThemeList';
import { Starfield } from './components/Starfield';
import { deleteImage, fetchThemeImages, fetchThemes } from './lib/api';
import { uploadImage, type UploadLevel } from './lib/upload';
import { goHome, useRoute } from './lib/route';
import { THEMES } from '../shared/themes';
import type { ThemeImage, ThemeSummary } from '../shared/types';

interface Job {
  key: string;
  name: string;
  previewUrl: string;
  progress: number;
  status: 'queued' | 'uploading' | 'done' | 'error';
  error?: string;
}

interface PendingUpload {
  level: UploadLevel;
  themeIndex: number;
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

  const [themes, setThemes] = useState<ThemeSummary[]>([]);
  const [themesLoading, setThemesLoading] = useState(true);

  const [images, setImages] = useState<ThemeImage[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // 用 ref 而不是 state：file input 的 onChange 触发时读到的必须是最新值
  const pendingRef = useRef<PendingUpload | null>(null);

  const loadThemes = useCallback(async () => {
    setThemesLoading(true);
    setError(null);
    try {
      setThemes(await fetchThemes());
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setThemesLoading(false);
    }
  }, []);

  const loadTheme = useCallback(async (index: number) => {
    setDetailLoading(true);
    setError(null);
    try {
      const data = await fetchThemeImages(index);
      setImages(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (route.name === 'home') void loadThemes();
    else void loadTheme(route.index);
  }, [route, loadThemes, loadTheme]);

  // ── 上传 ──────────────────────────────────────────
  const patchJob = (key: string, patch: Partial<Job>) => {
    setJobs((prev) => prev.map((job) => (job.key === key ? { ...job, ...patch } : job)));
  };

  function handleUploadClick() {
    if (route.name === 'theme') {
      // 二级页：上传的是该主题的图片，自动归属
      pendingRef.current = { level: 'image', themeIndex: route.index };
      fileInputRef.current?.click();
    } else {
      // 首页：上传的是某个主题的封面，先选主题
      setShowPicker(true);
    }
  }

  function handlePickTheme(themeIndex: number) {
    setShowPicker(false);
    pendingRef.current = { level: 'cover', themeIndex };
    // 仍在这次点击的手势上下文内，file input 才打得开
    fileInputRef.current?.click();
  }

  async function handleFiles(files: FileList | null) {
    const pending = pendingRef.current;
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!files?.length || !token || !pending) return;

    const picked = Array.from(files);
    const queued: Job[] = picked.map((file, i) => ({
      key: `${Date.now()}-${i}-${file.name}`,
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
          level: pending.level,
          themeIndex: pending.themeIndex,
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

    // 上传完重新拉取当前视图
    if (route.name === 'theme') await loadTheme(route.index);
    else await loadThemes();
  }

  // ── 删除 ──────────────────────────────────────────
  async function handleDelete(item: ThemeImage) {
    if (!token) return;
    if (!window.confirm('删除这张图片？此操作不可撤销。')) return;
    try {
      await deleteImage(item.key, token);
      setImages((prev) => prev.filter((p) => p.key !== item.key));
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  }

  const themeName = route.name === 'theme' ? (THEMES[route.index - 1]?.name ?? '') : '';

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
            <ThemeList
              themes={themes}
              loading={themesLoading}
              onOpen={(index) => {
                window.location.hash = `#/theme/${index}`;
              }}
            />
          ) : (
            <ThemeDetail
              themeName={themeName}
              items={images}
              isAdmin={isAdmin}
              loading={detailLoading}
              onBack={goHome}
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
