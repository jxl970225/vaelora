import { Hono } from 'hono';
import { THEMES, isValidTheme } from '../../shared/themes';
import { requireAdmin } from '../middleware';
import { publicUrl, purgeCdn } from '../lib/storage';
import type { FeedSection, GalleryItem } from '../../shared/types';

export const images = new Hono<{ Bindings: Env }>();

/** 首页每组最多展示的图片数（一级） */
const FEED_PAGE_SIZE = 8;
/** 二级页每次加载的图片数 */
const DEFAULT_PAGE_SIZE = 9;
const MAX_PAGE_SIZE = 60;

interface GalleryRow {
  id: string;
  theme: string;
  storage_path: string | null;
  bytes: number;
  width: number | null;
  height: number | null;
  created_at: number;
}

function toItem(env: Env, row: GalleryRow): GalleryItem {
  return {
    id: row.id,
    theme: row.theme,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    createdAt: row.created_at,
    url: publicUrl(env, row.id, row.storage_path),
  };
}

const GALLERY_COLUMNS = 'id, theme, storage_path, bytes, width, height, created_at';

/**
 * 首页信息流：按主题分组，每组带上最新的一页图片。
 *
 * 刻意做成单个接口而不是「8 个主题发 8 次请求」——免费版每天只有
 * 10 万次 Worker 请求，页面每多一次往返就少 10 万次浏览的余量。
 * 两次 D1 查询就能拼出全部数据，比 9 次 HTTP 往返划算得多。
 */
images.get('/feed', async (c) => {
  // 一次查询取每个主题最新的 N 张：窗口函数按主题分区排序，
  // 避免「查主题列表 → 循环查每个主题」的 N+1。
  const { results } = await c.env.DB.prepare(
    `SELECT ${GALLERY_COLUMNS} FROM (
       SELECT ${GALLERY_COLUMNS},
              ROW_NUMBER() OVER (PARTITION BY theme ORDER BY id DESC) AS rn
         FROM images
        WHERE status = 'published'
     ) WHERE rn <= ?
     ORDER BY theme, id DESC`
  )
    .bind(FEED_PAGE_SIZE)
    .all<GalleryRow>();

  const counts = await c.env.DB.prepare(
    `SELECT theme, COUNT(*) AS n FROM images WHERE status = 'published' GROUP BY theme`
  ).all<{ theme: string; n: number }>();
  const countByTheme = new Map(counts.results.map((r) => [r.theme, r.n]));

  const rowsByTheme = new Map<string, GalleryRow[]>();
  for (const row of results) {
    const list = rowsByTheme.get(row.theme);
    if (list) list.push(row);
    else rowsByTheme.set(row.theme, [row]);
  }

  // 按 THEMES 的顺序输出，空主题整组跳过（前端不用再处理"这组没图"）
  const sections: FeedSection[] = THEMES.flatMap((theme) => {
    const rows = rowsByTheme.get(theme.id);
    if (!rows?.length) return [];

    return [
      {
        theme: theme.id,
        name: theme.name,
        count: countByTheme.get(theme.id) ?? rows.length,
        items: rows.map((row) => toItem(c.env, row)),
        nextCursor: rows.length === FEED_PAGE_SIZE ? rows[rows.length - 1].id : null,
      },
    ];
  });

  return c.json({ sections });
});

/** 某个主题下的一页图片。首页各组的"加载更多"和二级页都用它。 */
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
 * 生产配了 R2 自定义域名后，这个端点不会被访问到。
 */
images.get('/:id/raw', async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT storage_path FROM images WHERE id = ? AND status = 'published'`
  )
    .bind(c.req.param('id'))
    .first<{ storage_path: string | null }>();

  if (!row?.storage_path) return c.notFound();

  const object = await c.env.BUCKET.get(row.storage_path);
  if (!object) return c.notFound();

  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'cache-control': 'public, max-age=300',
      etag: object.httpEtag,
    },
  });
});

/** 删除：管理员专属 */
images.delete('/:id', requireAdmin, async (c) => {
  const id = c.req.param('id');

  const row = await c.env.DB.prepare(
    `SELECT storage_path FROM images WHERE id = ? AND status != 'deleted'`
  )
    .bind(id)
    .first<{ storage_path: string | null }>();

  if (!row) return c.json({ error: '图片不存在' }, 404);

  // 先删对象、再清缓存：反过来的话，清理后会立刻被重新回源并再次缓存
  // R2 的 DeleteObject 是免费操作
  if (row.storage_path) await c.env.BUCKET.delete(row.storage_path);
  await purgeCdn(c.env, publicUrl(c.env, id, row.storage_path));

  // 留墓碑：清空对象引用，保留 id / seq / ip_hash 供追溯。
  // seq 保留是必要的 —— 序号不能因为删除而被复用。
  await c.env.DB.prepare(
    `UPDATE images SET status = 'deleted', storage_path = NULL WHERE id = ?`
  )
    .bind(id)
    .run();

  return c.body(null, 204);
});
