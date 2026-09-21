import { compress } from './compress';
import type { GalleryItem, UploadSession } from '../../shared/types';

const MAX_ATTEMPTS = 3;

/**
 * 必须用 XMLHttpRequest 而不是 fetch —— fetch 没有上传进度事件，
 * 移动端弱网下没有进度条用户会以为卡死。
 */
function putWithProgress(
  url: string,
  blob: Blob,
  token: string,
  onProgress: (pct: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('content-type', blob.type);
    xhr.setRequestHeader('authorization', `Bearer ${token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
        return;
      }
      let message = `上传失败 (${xhr.status})`;
      try {
        const body = JSON.parse(xhr.responseText) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        /* 响应不是 JSON，沿用默认文案 */
      }
      reject(new Error(message));
    };
    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.onabort = () => reject(new Error('上传已取消'));
    xhr.send(blob);
  });
}

async function createSession(blob: Blob, theme: string, token: string): Promise<UploadSession> {
  const res = await fetch('/api/uploads', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ contentType: blob.type, bytes: blob.size, theme }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? '创建上传会话失败');
  }
  return (await res.json()) as UploadSession;
}

export interface UploadResult {
  item: GalleryItem;
}

export interface UploadOptions {
  theme: string;
  token: string;
  onProgress?: (pct: number) => void;
  onPreview?: (previewUrl: string) => void;
}

export async function uploadImage(file: File, options: UploadOptions): Promise<UploadResult> {
  const { blob, width, height } = await compress(file);

  // 立刻给出本地预览，用户不用盯着白屏等上传
  const previewUrl = URL.createObjectURL(blob);
  options.onPreview?.(previewUrl);

  const session = await createSession(blob, options.theme, options.token);

  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      await putWithProgress(session.uploadUrl, blob, options.token, (pct) =>
        options.onProgress?.(pct)
      );
      lastError = undefined;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** (attempt - 1)));
      }
    }
  }
  if (lastError) throw lastError;

  const commit = await fetch(`/api/uploads/${session.id}/commit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${options.token}` },
    body: JSON.stringify({ width, height }),
  });
  if (!commit.ok) {
    const body = (await commit.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? '确认上传失败');
  }

  return {
    item: {
      id: session.id,
      theme: options.theme,
      bytes: blob.size,
      width,
      height,
      createdAt: Date.now(),
      url: `/api/images/${session.id}/raw`,
    },
  };
}
