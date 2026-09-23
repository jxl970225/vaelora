import type { ApiError, FeedSection, GalleryPage } from '../../shared/types';

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

/** 首页信息流：按主题分组，每组带最新一页图片。单个请求拿全部。 */
export async function fetchFeed(): Promise<FeedSection[]> {
  const res = await fetch('/api/images/feed');
  if (!res.ok) throw new Error(await readError(res, '加载失败'));
  const body = (await res.json()) as { sections: FeedSection[] };
  return body.sections;
}

export async function fetchThemeImages(
  theme: string,
  cursor?: string | null
): Promise<GalleryPage> {
  const url = new URL(`/api/images/themes/${theme}`, location.origin);
  if (cursor) url.searchParams.set('cursor', cursor);

  const res = await fetch(url);
  if (!res.ok) throw new Error(await readError(res, '加载图片失败'));
  return (await res.json()) as GalleryPage;
}

export async function deleteImage(id: string, token: string): Promise<void> {
  const res = await fetch(`/api/images/${id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
  // 404 视为已删除，不打扰用户
  if (!res.ok && res.status !== 404) {
    throw new Error(await readError(res, '删除失败'));
  }
}
