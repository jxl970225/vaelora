import { Hono } from 'hono';
import { THEME_COUNT, isValidThemeIndex } from '../../shared/themes';
import { listAll, metaKey, publicUrl, seqFromKey, themePrefix } from '../lib/storage';
import type { ThemeSummary, ThemeImage } from '../../shared/types';

export const images = new Hono<{ Bindings: Env }>();

/** `1.jpg` → 1。只认图片扩展名，描述文件 `1.json` 之类不算封面。 */
function indexFromCoverKey(key: string): number {
  const match = /^(\d+)\.(jpg|jpeg|png|webp|gif)$/i.exec(key);
  return match ? Number(match[1]) : 0;
}

/**
 * 首页：8 个固定位置的一级图片（封面）。
 *
 * 始终返回全部 8 个位置 —— 有封面的带 coverUrl，没有的 coverUrl 为 null。
 * 前端据此区分：浏览时跳过空位，管理员上传模式时在空位显示上传按钮。
 */
images.get('/themes', async (c) => {
  // delimiter 让根目录只返回「文件」和「子目录名」，不会展开子目录内容，
  // 所以这个查询的开销不随二级图片数量增长。
  const listed = await c.env.BUCKET.list({ delimiter: '/' });

  const coverByIndex = new Map<number, R2Object>();
  for (const object of listed.objects) {
    const index = indexFromCoverKey(object.key);
    if (index >= 1 && index <= THEME_COUNT) coverByIndex.set(index, object);
  }

  const folderIndexes = new Set(
    listed.delimitedPrefixes.map((p) => Number(p.replace(/\/$/, ''))).filter((n) => n > 0)
  );

  const themes: ThemeSummary[] = [];
  for (let index = 1; index <= THEME_COUNT; index++) {
    const cover = coverByIndex.get(index);
    themes.push({
      index,
      // 带 ?v= 是为了封面被替换后能穿透缓存 —— 文件名固定意味着缓存不会自己失效
      coverUrl: cover ? `${publicUrl(c.env, cover.key)}?v=${cover.uploaded.getTime()}` : null,
      hasImages: folderIndexes.has(index),
    });
  }

  return c.json({ themes });
});

/** 二级页：某个位置目录下的全部图片，按序号排列。 */
images.get('/themes/:index', async (c) => {
  const index = Number(c.req.param('index'));
  if (!isValidThemeIndex(index)) return c.json({ error: 'Theme not found' }, 404);

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

  // 位置描述存在 {n}.json，是可选字段。读不到或缺文件时返回 null。
  const meta = await c.env.BUCKET.get(metaKey(index));
  let description: string | null = null;
  if (meta) {
    try {
      const parsed = JSON.parse(await meta.text()) as { description?: unknown };
      description =
        typeof parsed.description === 'string' && parsed.description.trim()
          ? parsed.description.trim()
          : null;
    } catch {
      description = null;
    }
  }

  return c.json({ index, description, items });
});
