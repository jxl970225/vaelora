import { Hono } from 'hono';
import { requireAdmin } from '../middleware';
import { THEMES } from '../../shared/themes';
import { imageKey, nextSeq, publicUrl } from '../lib/storage';

export const uploads = new Hono<{ Bindings: Env }>();

// 全部写操作都要管理员。前端那个"上传入口"只是 UI，绕过它直接打接口不需要任何技巧。
uploads.use('*', requireAdmin);

const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function extensionFor(contentType: string): string {
  return EXTENSION_BY_TYPE[contentType] ?? 'jpg';
}

function parseTheme(raw: string | undefined): number | null {
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 1 || index > THEMES.length) return null;
  return index;
}

/**
 * 上传图片。一次请求写一个对象 —— 没有数据库，所以不需要
 * 「建会话 → 传字节 → 确认」那三步。
 *
 *   POST /api/uploads?level=cover&theme=3     一级：封面，写成 3.jpg
 *   POST /api/uploads?level=image&theme=3     二级：写成 3/3-{序号}.jpg
 *
 * body 是图片字节，content-type 决定扩展名，可选 width/height 存进对象元数据。
 */
uploads.post('/', async (c) => {
  const maxBytes = Number(c.env.MAX_UPLOAD_BYTES);

  const level = c.req.query('level');
  if (level !== 'cover' && level !== 'image') {
    return c.json({ error: 'level 必须是 cover 或 image' }, 400);
  }

  const index = parseTheme(c.req.query('theme'));
  if (index === null) return c.json({ error: '主题无效' }, 400);

  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.startsWith('image/')) {
    return c.json({ error: '只支持图片格式' }, 415);
  }

  const declared = Number(c.req.header('content-length') ?? '0');
  if (declared > maxBytes) {
    return c.json({ error: `图片需小于 ${Math.floor(maxBytes / 1024 / 1024)}MB` }, 413);
  }

  const width = Number(c.req.query('width'));
  const height = Number(c.req.query('height'));
  const customMetadata: Record<string, string> = {};
  if (Number.isFinite(width) && width > 0) customMetadata.width = String(width);
  if (Number.isFinite(height) && height > 0) customMetadata.height = String(height);

  const ext = extensionFor(contentType);

  let key: string;
  if (level === 'cover') {
    key = `${index}.${ext}`;
    // 封面名固定，换封面时旧扩展名的文件会变成孤儿，先清掉
    const existing = await c.env.BUCKET.list({ prefix: `${index}.` });
    const stale = existing.objects.filter((o) => o.key !== key);
    if (stale.length > 0) {
      await c.env.BUCKET.delete(stale.map((o) => o.key));
    }
  } else {
    const seq = await nextSeq(c.env.BUCKET, index);
    key = imageKey(index, seq, ext);
  }

  // 流式写入，不读进内存；put() 返回的对象带真实大小，可以拿来兜底校验
  const object = await c.env.BUCKET.put(key, c.req.raw.body, {
    httpMetadata: { contentType, cacheControl: 'public, max-age=300' },
    customMetadata,
  });

  if (object.size > maxBytes) {
    await c.env.BUCKET.delete(key);
    return c.json({ error: '图片超出大小限制' }, 413);
  }

  if (object.size === 0) {
    await c.env.BUCKET.delete(key);
    return c.json({ error: '图片内容为空' }, 400);
  }

  return c.json({
    key,
    url: publicUrl(c.env, key),
    size: object.size,
    width: customMetadata.width ? Number(customMetadata.width) : null,
    height: customMetadata.height ? Number(customMetadata.height) : null,
  });
});

/** 删除一张图片。key 直接来自前端，必须校验它落在某个主题目录内。 */
uploads.delete('/', async (c) => {
  const key = c.req.query('key');
  if (!key) return c.json({ error: '缺少 key' }, 400);

  // 只允许删二级图片（{主题号}/...），删封面走换封面覆盖，
  // 而且这样能挡住 key 被构造成 `../../` 之类的路径穿越
  const match = /^(\d+)\/\1-\d+\.[^.]+$/.exec(key);
  if (!match) return c.json({ error: '只能删除主题目录下的图片' }, 400);

  const index = Number(match[1]);
  if (index < 1 || index > THEMES.length) {
    return c.json({ error: '主题无效' }, 400);
  }

  const existing = await c.env.BUCKET.head(key);
  if (!existing) return c.json({ error: '图片不存在' }, 404);

  await c.env.BUCKET.delete(key);
  return c.body(null, 204);
});
