import { Hono } from 'hono';
import { THEMES, isValidTheme } from '../../shared/themes';
import { requireAdmin } from '../middleware';
import type { GalleryItem, ThemeSummary } from '../../shared/types';

export const images = new Hono<{ Bindings: Env }>();

const DEFAULT_PAGE_SIZE = 24;
const MAX_PAGE_SIZE = 60;

interface GalleryRow {
  id: string;
  theme: string;
  r2_key: string | null;
  bytes: number;
  width: number | null;
  height: number | null;
  created_at: number;
}

/**
 * 配了 R2 自定义域名就走直连（CDN 缓存，不消耗 Worker 请求）；
 * 没配则回落到 Worker 代理 —— 本地开发就是这条路径。
 */
function publicUrl(env: Env, id: string, r2Key: string | null): string {
  const base = env.IMAGE_BASE_URL?.trim();
  if (base && r2Key) return `${base.replace(/\/+$/, '')}/${r2Key}`;
  return `/api/images/${id}/raw`;
}

function toItem(env: Env, row: GalleryRow): GalleryItem {
  return {
    id: row.id,
    theme: row.theme,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
    url: publicUrl(env, row.id, row.r2_key),
  };
}

const GALLERY_COLUMNS = 'id, theme, r2_key, bytes, width, height, created_at';

/**
 * 首页：八个主题栏位。
 * 始终返回全部 8 个（没图的 count=0、cover=null），顺序由 THEMES 决定，
 * 这样前端不需要处理"某个主题不存在"的情况。
 */
images.get('/themes', async (c) => {
  // 每个主题取最新一张作封面。窗口函数比跑 8 次查询好。
  const covers = await c.env.DB.prepare(
    `SELECT theme, id, r2_key, width, height FROM (
       SELECT theme, id, r2_key, width, height,
              ROW_NUMBER() OVER (PARTITION BY theme ORDER BY id DESC) AS rn
         FROM images
        WHERE status = 'published'
     ) WHERE rn = 1`
  ).all<{
    theme: string;
    id: string;
    r2_key: string | null;
    width: number | null;
    height: number | null;
  }>();

  const counts = await c.env.DB.prepare(
    `SELECT theme, COUNT(*) AS n FROM images WHERE status = 'published' GROUP BY theme`
  ).all<{ theme: string; n: number }>();

  const coverByTheme = new Map(covers.results.map((r) => [r.theme, r]));
  const countByTheme = new Map(counts.results.map((r) => [r.theme, r.n]));

  const themes: ThemeSummary[] = THEMES.map((theme) => {
    const cover = coverByTheme.get(theme.id);
    return {
      id: theme.id,
      name: theme.name,
      count: countByTheme.get(theme.id) ?? 0,
      cover: cover
        ? {
            id: cover.id,
            url: publicUrl(c.env, cover.id, cover.r2_key),
            width: cover.width,
            height: cover.height,
          }
        : null,
    };
  });

  return c.json({ themes });
});

/** 二级页：某主题下的图片，keyset 分页（ULID 字典序即时间序） */
images.get('/themes/:theme', async (c) => {
  const theme = c.req.param('theme');
  if (!isValidTheme(theme)) return c.json({ error: '主题不存在' }, 404);

  const cursor = c.req.query('cursor');
  const requested = Number(c.req.query('limit'));
  const limit = Math.min(
    Number.isFinite(requested) && requested > 0 ? requested : DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE
  );

  const query = cursor
    ? c.env.DB.prepare(
        `SELECT ${GALLERY_COLUMNS} FROM images
          WHERE status = 'published' AND theme = ? AND id < ?
          ORDER BY id DESC LIMIT ?`
      ).bind(theme, cursor, limit)
    : c.env.DB.prepare(
        `SELECT ${GALLERY_COLUMNS} FROM images
          WHERE status = 'published' AND theme = ?
          ORDER BY id DESC LIMIT ?`
      ).bind(theme, limit);

  const { results } = await query.all<GalleryRow>();

  return c.json({
    items: results.map((row) => toItem(c.env, row)),
    nextCursor: results.length === limit ? results[results.length - 1].id : null,
  });
});

/**
 * 图片字节。仅作为本地开发的回落路径。
 * 生产走 R2 自定义域名，这个端点不会被访问到。
 */
images.get('/:id/raw', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT r2_key FROM images WHERE id = ? AND status = 'published'`
  )
    .bind(c.req.param('id'))
    .first<{ r2_key: string | null }>();

  if (!row?.r2_key) return c.notFound();

  const object = await c.env.BUCKET.get(row.r2_key);
  if (!object) return c.notFound();

  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'public, max-age=300',
      etag: object.httpEtag,
    },
  });
});

/**
 * 清掉 CDN 上这条图片的缓存。
 *
 * 必须做：图片缓存是长 TTL（immutable），删了 R2 对象但边缘节点还留着，
 * 用户会以为删掉了、实际仍能访问 —— 对画廊内容是隐私事故。
 * 没配 CF_ZONE_ID / token 时静默跳过，靠 TTL 自然过期。
 */
async function purgeCdn(env: Env, url: string): Promise<void> {
  const zoneId = env.CF_ZONE_ID?.trim();
  const token = env.CF_CACHE_PURGE_TOKEN?.trim();
  if (!zoneId || !token) return;

  try {
    await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ files: [url] }),
    });
  } catch {
    // 清理失败不该让删除操作失败。TTL 到期后会自然失效。
  }
}

/** 删除：管理员专属 */
images.delete('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');

  const row = await c.env.DB.prepare(
    `SELECT r2_key, thumb_key FROM images WHERE id = ? AND status != 'deleted'`
  )
    .bind(id)
    .first<{ r2_key: string | null; thumb_key: string | null }>();

  if (!row) return c.json({ error: '图片不存在' }, 404);

  // 先删对象、再清缓存：反过来的话，清理后会立刻被重新回源并再次缓存
  // R2 的 DeleteObject 是免费操作
  if (row.r2_key) await c.env.BUCKET.delete(row.r2_key);
  if (row.thumb_key) await c.env.BUCKET.delete(row.thumb_key);
  await purgeCdn(c.env, publicUrl(c.env, id, row.r2_key));

  // 留墓碑：清空对象引用，保留 id / ip_hash 供追溯
  await c.env.DB.prepare(
    `UPDATE images SET status = 'deleted', r2_key = NULL, thumb_key = NULL WHERE id = ?`
  )
    .bind(id)
    .run();

  return c.body(null, 204);
});
