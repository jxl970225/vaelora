import { Hono } from 'hono';
import { requireAdmin } from '../middleware';
import { isValidThemeIndex } from '../../shared/themes';
import { imageKey, metaKey, nextSeq, publicUrl } from '../lib/storage';

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
  if (!isValidThemeIndex(index)) return null;
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
    return c.json({ error: 'level must be cover or image' }, 400);
  }

  const index = parseTheme(c.req.query('theme'));
  if (index === null) return c.json({ error: 'Invalid theme' }, 400);

  const contentType = c.req.header('content-type') ?? '';
  if (!contentType.startsWith('image/')) {
    return c.json({ error: 'Only image formats are supported' }, 415);
  }

  const declared = Number(c.req.header('content-length') ?? '0');
  if (declared > maxBytes) {
    return c.json({ error: `Image must be smaller than ${Math.floor(maxBytes / 1024 / 1024)}MB` }, 413);
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
    // 封面名固定，换封面时旧扩展名的图片会变成孤儿，先清掉。
    // 注意只删图片文件 —— 描述文件 {index}.json 也在同一个前缀下，绝不能误删。
    const existing = await c.env.BUCKET.list({ prefix: `${index}.` });
    const stale = existing.objects.filter(
      (o) => o.key !== key && /\.(jpg|jpeg|png|webp|gif)$/i.test(o.key)
    );
    if (stale.length > 0) {
      await c.env.BUCKET.delete(stale.map((o) => o.key));
    }
  } else {
    // 二级图片。可选 `seq` 参数指定固定序号 —— 用于补位：
    // 管理员在缺失的序号位置上传，把图填到那个固定位置而不是追加到末尾。
    const seqParam = Number(c.req.query('seq'));
    let seq: number;
    if (Number.isInteger(seqParam) && seqParam >= 1 && seqParam <= 9999) {
      // 该序号是否已被占用（不论扩展名）
      const occupied = await c.env.BUCKET.list({ prefix: `${index}/${index}-${seqParam}.` });
      if (occupied.objects.length > 0) {
        return c.json({ error: 'That position is already taken' }, 409);
      }
      seq = seqParam;
    } else {
      seq = await nextSeq(c.env.BUCKET, index);
    }
    key = imageKey(index, seq, ext);
  }

  // 流式写入，不读进内存；put() 返回的对象带真实大小，可以拿来兜底校验
  const object = await c.env.BUCKET.put(key, c.req.raw.body, {
    httpMetadata: { contentType, cacheControl: 'public, max-age=300' },
    customMetadata,
  });

  if (object.size > maxBytes) {
    await c.env.BUCKET.delete(key);
    return c.json({ error: 'Image exceeds the size limit' }, 413);
  }

  if (object.size === 0) {
    await c.env.BUCKET.delete(key);
    return c.json({ error: 'Image is empty' }, 400);
  }

  return c.json({
    key,
    url: publicUrl(c.env, key),
    size: object.size,
    width: customMetadata.width ? Number(customMetadata.width) : null,
    height: customMetadata.height ? Number(customMetadata.height) : null,
  });
});

/**
 * 上传/更新某主题的描述文字，写成 {主题号}.json。
 * 描述是主题级属性，和封面图片解耦 —— 换封面不会丢描述。
 */
uploads.post('/description', async (c) => {
  const index = parseTheme(c.req.query('theme'));
  if (index === null) return c.json({ error: 'Invalid theme' }, 400);

  const body = await c.req
    .json<{ description?: string }>()
    .catch(() => ({}) as { description?: string });

  const description = (body.description ?? '').trim();
  if (!description) return c.json({ error: 'Description is empty' }, 400);
  if (description.length > 2000) return c.json({ error: 'Description is too long' }, 413);

  await c.env.BUCKET.put(metaKey(index), JSON.stringify({ description }), {
    httpMetadata: { contentType: 'application/json', cacheControl: 'public, max-age=300' },
  });

  return c.json({ index, description });
});

/** 删除一张图片。key 直接来自前端，必须校验它落在某个主题目录内。 */
uploads.delete('/', async (c) => {
  const key = c.req.query('key');
  if (!key) return c.json({ error: 'Missing key' }, 400);

  // 只允许删二级图片（{主题号}/...），删封面走换封面覆盖，
  // 而且这样能挡住 key 被构造成 `../../` 之类的路径穿越
  const match = /^(\d+)\/\1-\d+\.[^.]+$/.exec(key);
  if (!match) return c.json({ error: 'Can only delete images within a theme folder' }, 400);

  const index = Number(match[1]);
  if (!isValidThemeIndex(index)) {
    return c.json({ error: 'Invalid theme' }, 400);
  }

  const existing = await c.env.BUCKET.head(key);
  if (!existing) return c.json({ error: 'Image not found' }, 404);

  await c.env.BUCKET.delete(key);
  return c.body(null, 204);
});
