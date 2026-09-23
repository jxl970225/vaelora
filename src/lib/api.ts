import type { ApiError, ThemeImages, ThemeSummary } from '../../shared/types';

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as Partial<ApiError>;
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function login(username: string, password: string): Promise<string> {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(await readError(res, '登录失败'));
  const body = (await res.json()) as { token: string };
  return body.token;
}

/** 一级：主题封面。没有封面的主题不会出现在结果里。 */
export async function fetchThemes(): Promise<ThemeSummary[]> {
  const res = await fetch('/api/images/themes');
  if (!res.ok) throw new Error(await readError(res, '加载失败'));
  const body = (await res.json()) as { themes: ThemeSummary[] };
  return body.themes;
}

/** 二级：某个主题目录下的全部图片 */
export async function fetchThemeImages(index: number): Promise<ThemeImages> {
  const res = await fetch(`/api/images/themes/${index}`);
  if (!res.ok) throw new Error(await readError(res, '加载失败'));
  return (await res.json()) as ThemeImages;
}

export async function deleteImage(key: string, token: string): Promise<void> {
  const res = await fetch(`/api/uploads?key=${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
  // 404 视为已删除，不打扰用户
  if (!res.ok && res.status !== 404) {
    throw new Error(await readError(res, '删除失败'));
  }
}
