import type { Context } from 'hono';

/**
 * 图片字节的代理，URL 形如 /api/file/1/1-1.jpg，和 R2 里的键一一对应。
 *
 * 配了 R2 自定义域名后前端不会走这里；本地开发和没绑域名时靠它兜底。
 *
 * 路由注册为 `/api/file/:key{.+}` 而不是 `/api/file/*`：Hono 4.13 下
 * `'/*'` 虽然能匹配，但 `c.req.param('*')` 返回 undefined —— 拿不到 key，
 * 表现成"图片全部 404"。带名字的正则参数单段多段都能正确取值。
 */
export async function serveFile(c: Context<{ Bindings: Env }>): Promise<Response> {
  const key = (c.req.param('key') ?? '').replace(/^\/+/, '');

  // 挡住路径穿越：key 会直接拼进 R2 查询，不能让它跳出桶内的约定结构。
  // 只接受 `{主题号}/...` 或 `{主题号}.{扩展名}` 这两种形态。
  if (!/^\d+(\/[\w.-]+|\.[A-Za-z0-9]+)$/.test(key) || key.includes('..')) {
    return c.notFound();
  }

  const object = await c.env.BUCKET.get(key);
  if (!object) return c.notFound();

  return new Response(object.body, {
    headers: {
      'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      // 二级图片名含序号且序号不复用，内容不变；封面名固定但 URL 上带了 ?v= 版本参数
      'cache-control': 'public, max-age=300',
      etag: object.httpEtag,
    },
  });
}
