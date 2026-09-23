import { Hono } from 'hono';
import { THEMES } from '../../shared/themes';
import { listAll, publicUrl, seqFromKey, themePrefix } from '../lib/storage';
import type { ThemeSummary, ThemeImage } from '../../shared/types';

export const images = new Hono<{ Bindings: Env }>();

/** `1.jpg` → 1。不是封面命名就返回 0。 */
function indexFromCoverKey(key: string): number {
  const match = /^(\d+)\.[^.]+$/.exec(key);
  return match ? Number(match[1]) : 0;
}

function themeName(index: number): string {
  return THEMES[index - 1]?.name ?? `主题 ${index}`;
}

/**
 * 首页：一级图片（主题封面）。
 *
 * 封面文件名固定为 `{主题号}.jpg`，所以「有没有封面」直接看对象存不存在，
 * 不需要数据库记录。带 `?v=` 是为了在封面被替换后能穿透缓存 ——
 * 文件名固定意味着缓存不会自己失效。
 */
images.get('/themes', async (c) => {
  // delimiter 让根目录只返回「文件」和「子目录名」，不会展开子目录内容，
  // 所以这个查询的开销不随二级图片数量增长。
  const listed = await c.env.BUCKET.list({ delimiter: '/' });

  const coverByIndex = new Map<number, R2Object>();
  for (const object of listed.objects) {
    const index = indexFromCoverKey(object.key);
    if (index >= 1 && index <= THEMES.length) coverByIndex.set(index, object);
  }

  const folderIndexes = new Set(
    listed.delimitedPrefixes.map((p) => Number(p.replace(/\/$/, ''))).filter((n) => n > 0)
  );

  const themes: ThemeSummary[] = [];
  for (let index = 1; index <= THEMES.length; index++) {
    const cover = coverByIndex.get(index);
    // 没有封面就不返回 —— 前端不用处理"这个主题没图"的情况
    if (!cover) continue;

    themes.push({
      index,
      name: themeName(index),
      coverUrl: `${publicUrl(c.env, cover.key)}?v=${cover.uploaded.getTime()}`,
      hasImages: folderIndexes.has(index),
    });
  }

  return c.json({ themes });
});

/** 二级页：某个主题目录下的全部图片，按序号排列。 */
images.get('/themes/:index', async (c) => {
  const index = Number(c.req.param('index'));
  if (!Number.isInteger(index) || index < 1 || index > THEMES.length) {
    return c.json({ error: '主题不存在' }, 404);
  }

  const objects = await listAll(c.env.BUCKET, themePrefix(index));

  const items: ThemeImage[] = objects
    .map((object) => ({ object, seq: seqFromKey(object.key, index) }))
    .filter(({ seq }) => seq > 0) // 目录里的非约定命名文件直接忽略
    // R2 返回的是字典序（1-10 排在 1-2 前），按数字重排
    .sort((a, b) => a.seq - b.seq)
    .map(({ object, seq }) => ({
      seq,
      key: object.key,
      url: publicUrl(c.env, object.key),
      size: object.size,
      width: Number(object.customMetadata?.width) || null,
      height: Number(object.customMetadata?.height) || null,
    }));

  return c.json({ index, name: themeName(index), items });
});
