import { Hono } from 'hono';
import { ulid } from '../lib/ulid';
import { hashIp } from '../lib/crypto';
import { requireAdmin } from '../middleware';
import { isValidTheme } from '../../shared/themes';

export const uploads = new Hono<{ Bindings: Env }>();

// 全部写操作都要管理员。前端那个"上传入口"只是 UI，绕过它直接打接口不需要任何技巧。
uploads.use('*', requireAdmin);

/**
 * R2 key 带上扩展名不是为了好看：Cloudflare 只对特定扩展名默认启用缓存，
 * 无扩展名的 key 走 R2 自定义域名时不会命中 CDN，等于白配。
 * 图片内容不可变（key 里含 ULID，永不复用），所以可以长期缓存，删除靠主动清理。
 */
const EXTENSION_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

function extensionFor(contentType: string): string {
  return EXTENSION_BY_TYPE[contentType] ?? 'bin';
}

/**
 * 缓存时长取决于「删除的即时性怎么保证」：
 *
 * - 配了 ZONE_ID + purge token → 主动清理，可以用长缓存 + immutable
 * - 没配 → 只能靠 TTL 自然过期，必须用短 TTL。
 *   这里若图省事用一年，删除后的图片会在 CDN 上继续可见一年 ——
 *   管理员删掉违规内容却还在展示，是实打实的事故。
 */
function cacheControlFor(env: Env): string {
  const canPurge = Boolean(env.CF_ZONE_ID?.trim() && env.CF_CACHE_PURGE_TOKEN?.trim());
  return canPurge ? 'public, max-age=31536000, immutable' : 'public, max-age=300';
}

/** ① 创建上传会话 */
uploads.post('/', async (c) => {
  const maxBytes = Number(c.env.MAX_UPLOAD_BYTES);
  const body = await c.req
    .json<{ contentType?: string; bytes?: number; theme?: string }>()
    .catch(() => ({}) as { contentType?: string; bytes?: number; theme?: string });

  const contentType = body.contentType ?? '';
  const bytes = Number(body.bytes);
  const theme = body.theme ?? '';

  if (!isValidTheme(theme)) {
    return c.json({ error: '主题无效' }, 400);
  }
  if (!contentType.startsWith('image/')) {
    return c.json({ error: '只支持图片格式' }, 415);
  }
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > maxBytes) {
    return c.json({ error: `图片需小于 ${Math.floor(maxBytes / 1024 / 1024)}MB` }, 413);
  }

  const id = ulid();
  // 两级路径：主题/图片 id.扩展名，和展示层级一致
  const r2Key = `${theme}/${id}.${extensionFor(contentType)}`;

  await c.env.DB.prepare(
    `INSERT INTO images
       (id, r2_key, theme, content_type, bytes, status, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`
  )
    .bind(
      id,
      r2Key,
      theme,
      contentType,
      bytes,
      await hashIp(c.req.header('cf-connecting-ip') ?? 'unknown', c.env.IP_SALT),
      Date.now()
    )
    .run();

  return c.json({ id, key: r2Key, theme, uploadUrl: `/api/uploads/${id}/data` }, 201);
});

/**
 * ② 接收字节写入 R2。
 * `c.req.raw.body` 是 ReadableStream，R2 直接流式落盘，不读进内存。
 */
uploads.put('/:id/data', async (c) => {
  const id = c.req.param('id');
  const maxBytes = Number(c.env.MAX_UPLOAD_BYTES);

  const row = await c.env.DB.prepare(
    `SELECT r2_key, status, bytes FROM images WHERE id = ?`
  )
    .bind(id)
    .first<{ r2_key: string | null; status: string; bytes: number }>();

  if (!row) return c.json({ error: '上传会话不存在' }, 404);
  if (row.status === 'deleted') return c.json({ error: '该图片已被删除' }, 410);
  if (row.status === 'rejected') return c.json({ error: '该上传已被拒绝' }, 410);

  // 幂等：上一次可能已经成功落盘，只是响应没送达客户端就触发了重试
  if (row.status === 'published' || row.status === 'uploaded') {
    return c.json({ bytes: row.bytes, alreadyUploaded: true });
  }
  if (!row.r2_key) return c.json({ error: '上传会话已失效' }, 410);

  const declared = Number(c.req.header('content-length') ?? '0');
  if (declared > maxBytes) {
    return c.json({ error: '图片超出大小限制' }, 413);
  }

  const contentType = c.req.header('content-type') ?? 'application/octet-stream';
  if (!contentType.startsWith('image/')) {
    return c.json({ error: '只支持图片格式' }, 415);
  }

  const object = await c.env.BUCKET.put(row.r2_key, c.req.raw.body, {
    httpMetadata: {
      contentType,
      // 内容不可变（key 含 ULID 且不复用），所以能长缓存就长缓存
      cacheControl: cacheControlFor(c.env),
    },
  });

  // 自报体积可以撒谎，以 R2 实际落盘大小为准兜底
  if (object.size > maxBytes) {
    await c.env.BUCKET.delete(row.r2_key);
    await c.env.DB.prepare(`UPDATE images SET status = 'rejected' WHERE id = ?`).bind(id).run();
    return c.json({ error: '图片超出大小限制' }, 413);
  }

  await c.env.DB.prepare(
    `UPDATE images SET bytes = ?, status = 'uploaded' WHERE id = ? AND status = 'pending'`
  )
    .bind(object.size, id)
    .run();

  return c.json({ bytes: object.size });
});

/** ③ 确认落盘，置为可见 */
uploads.post('/:id/commit', async (c) => {
  const id = c.req.param('id');
  const body = await c.req
    .json<{ width?: number; height?: number }>()
    .catch(() => ({}) as { width?: number; height?: number });

  const row = await c.env.DB.prepare(`SELECT status FROM images WHERE id = ?`)
    .bind(id)
    .first<{ status: string }>();

  if (!row) return c.json({ error: '上传会话不存在' }, 404);
  if (row.status === 'deleted') return c.json({ error: '该图片已被删除' }, 410);
  if (row.status === 'published') return c.json({ id, status: 'published' });
  // 必须先真正落盘才能发布，否则只建会话不传字节就能在画廊里刷出空记录
  if (row.status !== 'uploaded') {
    return c.json({ error: '请先完成图片上传' }, 409);
  }

  const width = Number(body.width);
  const height = Number(body.height);

  const result = await c.env.DB.prepare(
    `UPDATE images SET status = 'published', width = ?, height = ?
      WHERE id = ? AND status = 'uploaded'`
  )
    .bind(Number.isFinite(width) ? width : null, Number.isFinite(height) ? height : null, id)
    .run();

  if (!result.meta.changes) {
    return c.json({ error: '上传尚未完成' }, 409);
  }

  return c.json({ id, status: 'published' });
});
