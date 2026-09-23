import { compress } from './compress';

export type UploadLevel = 'cover' | 'image';

export interface UploadOptions {
  level: UploadLevel;
  themeIndex: number;
  token: string;
  onProgress?: (pct: number) => void;
  /** 压缩完成即回调，用于立刻显示本地预览 */
  onPreview?: (previewUrl: string) => void;
}

export interface UploadResult {
  key: string;
  url: string;
  size: number;
  width: number | null;
  height: number | null;
  previewUrl: string;
}

/**
 * 一次请求完成上传。
 *
 * 之前是「建会话 → 传字节 → 确认」三步，那套是为数据库里两阶段状态设计的。
 * 现在没有数据库，写进 R2 就是生效，一步就够。
 *
 * 仍然用 XMLHttpRequest：fetch 没有上传进度事件，移动端弱网下没有进度条
 * 用户会以为卡死。
 */
export async function uploadImage(file: File, options: UploadOptions): Promise<UploadResult> {
  const { blob, width, height } = await compress(file);

  // 立刻给出本地预览，用户不用盯着白屏等上传
  const previewUrl = URL.createObjectURL(blob);
  options.onPreview?.(previewUrl);

  const query = new URLSearchParams({
    level: options.level,
    theme: String(options.themeIndex),
    width: String(width),
    height: String(height),
  });

  const result = await new Promise<Omit<UploadResult, 'previewUrl'>>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/uploads?${query}`);
    xhr.setRequestHeader('content-type', blob.type);
    xhr.setRequestHeader('authorization', `Bearer ${options.token}`);

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) options.onProgress?.(event.loaded / event.total);
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        options.onProgress?.(1);
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error('服务端返回了无法解析的内容'));
        }
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

  return { ...result, previewUrl };
}
