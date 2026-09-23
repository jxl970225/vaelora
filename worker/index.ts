import { Hono } from 'hono';
import { admin } from './routes/admin';
import { uploads } from './routes/uploads';
import { images } from './routes/images';
import { serveFile } from './routes/file';

const app = new Hono<{ Bindings: Env }>();

app.route('/api/admin', admin);
app.route('/api/uploads', uploads);
app.route('/api/images', images);

// 用 `:key{.+}` 而不是 `/*` —— 见 routes/file.ts 里的说明
app.get('/api/file/:key{.+}', serveFile);

// 静态资源由 assets 配置处理；这里只兜底未匹配的 /api 请求。
app.all('/api/*', (c) => c.json({ error: 'Not found' }, 404));

export default app;
