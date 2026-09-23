interface Env {
  BUCKET: R2Bucket;
  MAX_UPLOAD_BYTES: string;
  IP_SALT: string;
  /** 管理员账号，普通变量即可（非敏感） */
  ADMIN_USER: string;
  /** 管理员密码的 sha256（十六进制），必须用 wrangler secret put 存 */
  ADMIN_PASSWORD_HASH: string;
  /** 签发会话 token 的密钥，必须用 wrangler secret put 存 */
  SESSION_SECRET: string;
  /**
   * R2 自定义域名，例如 https://img.example.com。留空则图片走 Worker 代理
   * （本地开发用）。生产建议配上，否则每次看图都消耗一次 Worker 请求。
   */
  IMAGE_BASE_URL: string;
}
