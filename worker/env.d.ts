interface Env {
  BUCKET: R2Bucket;
  DB: D1Database;
  MAX_UPLOAD_BYTES: string;
  IP_SALT: string;
  /** 管理员账号，普通变量即可（非敏感） */
  ADMIN_USER: string;
  /** 管理员密码的 sha256（十六进制），必须用 wrangler secret put 存 */
  ADMIN_PASSWORD_HASH: string;
  /** 签发会话 token 的密钥，必须用 wrangler secret put 存 */
  SESSION_SECRET: string;
  /**
   * R2 自定义域名，例如 https://img.example.com。
   * 留空则图片走 Worker 代理（本地开发用）——生产必须配上，
   * 否则每次看图都消耗一次 Worker 请求，免费额度会被快速打满。
   */
  IMAGE_BASE_URL: string;
  /** 缓存清理所需的 Zone ID 与 API token，不配则删除后依赖 CDN TTL 自然过期 */
  CF_ZONE_ID?: string;
  CF_CACHE_PURGE_TOKEN?: string;
}
