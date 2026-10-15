import { useCallback, useEffect, useRef, useState } from 'react';
import { BottomBar } from './components/BottomBar';
import { LoginModal } from './components/LoginModal';
import { DescriptionModal } from './components/ThemePicker';
import { ThemeDetail } from './components/ThemeDetail';
import { ThemeList } from './components/ThemeList';
import { Starfield } from './components/Starfield';
import { deleteImage, fetchThemeImages, fetchThemes, uploadDescription } from './lib/api';
import { uploadImage, type UploadLevel } from './lib/upload';
import { goHome, useRoute } from './lib/route';
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
  /** 封面附带的描述，只对 level === 'cover' 有意义 */
  description?: string;
  /** 指定固定序号（二级图片补位），不传则追加到末尾 */
  seq?: number;
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
  const [showDesc, setShowDesc] = useState(false);

  const [themes, setThemes] = useState<ThemeSummary[]>([]);
  const [themesLoading, setThemesLoading] = useState(true);

  const [images, setImages] = useState<ThemeImage[]>([]);
  const [description, setDescription] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // 用 ref 而不是 state：file input 的 onChange 触发时读到的必须是最新值
  const pendingRef = useRef<PendingUpload | null>(null);
  // 首页空位上传的目标位置（点空位按钮时记下，描述确认后使用）
  const coverTargetRef = useRef<number | null>(null);

  const loadThemes = useCallback(async () => {
    setThemesLoading(true);
    setError(null);
    try {
      setThemes(await fetchThemes());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
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
      setDescription(data.description);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
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

  // 首页空位按钮：记下目标位置，先弹描述框
  function handleUploadCover(index: number) {
    coverTargetRef.current = index;
    setShowDesc(true);
  }

  // 描述确认后：打开文件选择器
  function handleDescConfirm(description: string) {
    setShowDesc(false);
    const index = coverTargetRef.current;
    if (index === null) return;
    pendingRef.current = { level: 'cover', themeIndex: index, description };
    // 仍在这次点击的手势上下文内，file input 才打得开
    fileInputRef.current?.click();
  }

  // 二级页缺号槽位：上传到那个固定序号
  function handleUploadToSlot(seq: number) {
    if (route.name !== 'theme') return;
    pendingRef.current = { level: 'image', themeIndex: route.index, seq };
    fileInputRef.current?.click();
  }

  async function handleFiles(files: FileList | null) {
    // 先把 FileList 拷成数组，再清空 input —— 顺序不能反。
    // FileList 是活的：input.value = '' 会把已经拿到的那个 List 一并清空，
    // 之后读 length 就是 0，表现为"选完图什么都没发生"。
    const picked = files ? Array.from(files) : [];
    if (fileInputRef.current) fileInputRef.current.value = '';

    if (picked.length === 0) return;

    const pending = pendingRef.current;
    if (!token || !pending) {
      // 不要静默 return —— 那样用户只看到"点了没反应"，无从排查
      setError('Upload state lost — tap the upload button again');
      return;
    }

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
          seq: pending.seq,
          onPreview: (url) => patchJob(job.key, { previewUrl: url }),
          onProgress: (pct) => patchJob(job.key, { progress: pct }),
        });
        patchJob(job.key, { status: 'done', progress: 1 });
      } catch (e) {
        patchJob(job.key, {
          status: 'error',
          error: e instanceof Error ? e.message : 'Upload failed',
        });
      }
    }

    window.setTimeout(() => setJobs((prev) => prev.filter((job) => job.status !== 'done')), 1200);

    // 封面附带描述时，图片传完再存描述。描述失败不阻塞图片展示，单独提示。
    if (pending.level === 'cover' && pending.description) {
      try {
        await uploadDescription(pending.themeIndex, pending.description, token);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to save description');
      }
    }

    // 上传完重新拉取当前视图
    if (route.name === 'theme') await loadTheme(route.index);
    else await loadThemes();
  }

  // ── 删除 ──────────────────────────────────────────
  async function handleDelete(item: ThemeImage) {
    if (!token) return;
    if (!window.confirm('Delete this image? This cannot be undone.')) return;
    try {
      await deleteImage(item.key, token);
      setImages((prev) => prev.filter((p) => p.key !== item.key));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete');
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
          <p className="header__subtitle">Curated imagery, explored by collection</p>
          <p className="header__desc">
            A quiet, growing collection of photographs, gathered over time. New work is added as
            it comes — wander back every so often.
          </p>
        </header>

        {error && (
          <div className="banner banner--error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Close">
              ✕
            </button>
          </div>
        )}

        <main>
          {route.name === 'home' ? (
            <ThemeList
              themes={themes}
              loading={themesLoading}
              isAdmin={isAdmin}
              onOpen={(index) => {
                window.location.hash = `#/theme/${index}`;
              }}
              onUploadToSlot={handleUploadCover}
            />
          ) : (
            <ThemeDetail
              items={images}
              description={description}
              isAdmin={isAdmin}
              loading={detailLoading}
              onBack={goHome}
              onDelete={(item) => void handleDelete(item)}
              onUploadToSlot={handleUploadToSlot}
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

        {showDesc && (
          <DescriptionModal onConfirm={handleDescConfirm} onClose={() => setShowDesc(false)} />
        )}
      </div>
    </>
  );
}
