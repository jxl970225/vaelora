/**
 * 图片的对外 URL。
 *
 * 配了 R2 自定义域名就走直连（CDN 缓存，不消耗 Worker 请求）；
 * 没配则回落到 Worker 代理 —— 本地开发就是这条路径。
 */
export function publicUrl(env: Env, id: string, r2Key: string | null): string {
  const base = env.IMAGE_BASE_URL?.trim();
  if (base && r2Key) return `${base.replace(/\/+$/, '')}/${r2Key}`;
  return `/api/images/${id}/raw`;
}

/**
 * 缓存时长取决于「删除的即时性怎么保证」：
 *
 * - 配了 ZONE_ID + purge token → 主动清理，可以用长缓存 + immutable
 * - 没配 → 只能靠 TTL 自然过期，必须用短 TTL。
 *   这里若图省事用一年，删除后的图片会在 CDN 上继续可见一年 ——
 *   管理员删掉违规内容却还在展示，是实打实的事故。
 */
export function cacheControlFor(env: Env): string {
  const canPurge = Boolean(env.CF_ZONE_ID?.trim() && env.CF_CACHE_PURGE_TOKEN?.trim());
  return canPurge ? 'public, max-age=31536000, immutable' : 'public, max-age=300';
}

/**
 * 清掉 CDN 上这条图片的缓存。
 *
 * 必须做：图片缓存是长 TTL（immutable），删了 R2 对象但边缘节点还留着，
 * 用户会以为删掉了、实际仍能访问 —— 对画廊内容是隐私事故。
 * 没配 CF_ZONE_ID / token 时静默跳过，靠 TTL 自然过期。
 */
export async function purgeCdn(env: Env, url: string): Promise<void> {
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
