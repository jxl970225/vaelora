export interface Compressed {
  blob: Blob;
  width: number;
  height: number;
}

/**
 * 长边 1600px 而不是 2048px：iOS 的 canvas 面积上限约 1600 万像素
 * （约 4096×4096），留足余量避免大图直接抛错。
 */
const MAX_EDGE = 1600;
const QUALITY = 0.82;

/**
 * 本地压缩 + 剥 EXIF。
 *
 * `imageOrientation: 'from-image'` 把 EXIF 里的方向信息烘焙进像素，
 * 之后 canvas 导出 JPEG 时整个 EXIF 块（含 GPS 经纬度）自然被丢弃 ——
 * 手机照片默认带定位，公开画廊里不剥就是隐私事故。
 */
export async function compress(file: File): Promise<Compressed> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('无法创建 canvas 上下文');
  }

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', QUALITY)
  );
  if (!blob) throw new Error('图片编码失败');

  return { blob, width, height };
}
