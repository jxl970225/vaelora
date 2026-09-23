import { Hono } from 'hono';
import { ulid } from '../lib/ulid';
import { hashIp } from '../lib/crypto';
import { cacheControlFor } from '../lib/storage';
import { requireAdmin } from '../middleware';
import { isValidTheme, themeIndex } from '../../shared/themes';

export const uploads = new Hono<{ Bindings: Env }>();

// 全部写操作都要管理员。前端那个"上传入口"只是 UI，绕过它直接打接口不需要任何技巧。
uploads.use('*', requireAdmin);

/**
 * 存储路径：{主题号}/{主题号}-{序号}.jpg
 *
 * 序号在每个主题内单调递增、**永不复用** —— 删掉 1-3 之后新图会拿到 1-4。
 * 这样「同一路径永远对应同一张图」成立，浏览器和 CDN 缓存才不会骗人。
 * 如果复用序号，删图后重新上传会顶掉旧名字，用户看到的还是缓存里的老图。
 */
async function allocateSeq(env: Env, theme: string): Promise<number> {
  await env.DB.prepare(`INSERT OR IGNORE INTO theme_counters (theme, next_seq) VALUES (?, 1)`)
    .bind(theme)
    .run();

  // 单条语句完成「自增 + 取值」，SQLite 的写串行化保证并发上传不会撞号。
  // RETURNING 看到的是自增后的值，所以减 1 才是本次分配的号。
  const row = await env.DB.prepare(
    `UPDATE theme_counters SET next_seq = next_seq + 1 WHERE theme = ? RETURNING next_seq - 1 AS seq`
  )
    .bind(theme)
    .first<{ seq: number }>();

  if (!row) throw new Error('取号失败');
  return row.seq;
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

  if (!isValidTheme(theme)) return c.json({ error: '主题无效' }, 400);
  if (!contentType.startsWith('image/')) return c.json({ error: '只支持图片格式' }, 415);
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > maxBytes) {
    return c.json({ error: `图片需小于 ${Math.floor(maxBytes / 1024 / 1024)}MB` }, 413);
  }

  const id = ulid();
  const seq = await allocateSeq(c.env, theme);
  const index = themeIndex(theme);
  const storagePath = `${index}/${index}-${seq}.jpg`;

  await c.env.DB.prepare(
    `INSERT INTO images
       (id, storage_path, seq, theme, content_type, bytes, status, ip_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  )
    .bind(
      id,
      storagePath,
      seq,
      theme,
      contentType,
      bytes,
      await hashIp(c.req.header('cf-connecting-ip') ?? 'unknown', c.env.IP_SALT),
      Date.now()
    )
    .run();

  return c.json({ id, key: storagePath, theme, uploadUrl: `/api/uploads/${id}/data` }, 201);
});

/**
 * ② 接收字节并写入 R2。
 *
 * `c.req.raw.body` 是 ReadableStream，R2 直接流式落盘 —— 不读进内存，
 * 所以不受 Worker 128MB 内存限制约束。而且 put() 会返回对象的真实大小，
 * 流式写入也能校验客户端自报的体积是否属实。
 */
uploads.put('/:id/data', async (c) => {
  const id = c.req.param('id');
  const maxBytes = Number(c.env.MAX_UPLOAD_BYTES);

  const row = await c.env.DB.prepare(
    `SELECT storage_path, status, bytes FROM images WHERE id = ?`
  )
    .bind(id)
    .first<{ storage_path: string | null; status: string; bytes: number }>();

  if (!row) return c.json({ error: '上传会话不存在' }, 404);
  if (row.status === 'deleted') return c.json({ error: '该图片已被删除' }, 410);
  if (row.status === 'rejected') return c.json({ error: '该上传已被拒绝' }, 410);
  // 幂等：上一次可能已经成功落盘，只是响应没送达客户端就触发了重试
  if (row.status === 'published' || row.status === 'uploaded') {
    return c.json({ bytes: row.bytes, alreadyUploaded: true });
  }
  if (!row.storage_path) return c.json({ error: '上传会话已失效' }, 410);

  const declared = Number(c.req.header('content-length') ?? '0');
  if (declared > maxBytes) return c.json({ error: '图片超出大小限制' }, 413);

  const contentType = c.req.header('content-type') ?? 'application/octet-stream';
  if (!contentType.startsWith('image/')) return c.json({ error: '只支持图片格式' }, 415);

  const object = await c.env.BUCKET.put(row.storage_path, c.req.raw.body, {
    httpMetadata: {
      contentType,
      cacheControl: cacheControlFor(c.env),
    },
  });

  // 客户端自报体积可以撒谎，以 R2 实际落盘大小为准兜底
  if (object.size > maxBytes) {
    await c.env.BUCKET.delete(row.storage_path);
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

  if (!result.meta.changes) return c.json({ error: '上传尚未完成' }, 409);

  return c.json({ id, status: 'published' });
});
