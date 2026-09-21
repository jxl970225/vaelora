import { createMiddleware } from 'hono/factory';
import { verifyToken } from './lib/auth';

/** 上传、删除等写操作统一挂这个中间件。前端怎么藏入口都不算安全措施，服务端必须验。 */
export const requireAdmin = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token || !(await verifyToken(c.env.SESSION_SECRET, token))) {
    return c.json({ error: '需要管理员权限' }, 401);
  }
  await next();
});
