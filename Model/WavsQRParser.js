/**
 * Robust QR parser for compressed, low-contrast, inverted and slightly rotated images.
 * First tries the original image, then a small set of increasingly expensive variants.
 */
import { readBarcodes } from 'zxing-wasm';
import { scanGrayBuffer } from '@undecaf/zbar-wasm';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const MAX_SIDE = 2800;
const MAX_INPUT_PIXELS = 50_000_000;
const ZXING_OPTIONS = {
  formats: ['QRCode'],
  tryHarder: true,
  tryRotate: true,
  tryInvert: true,
  tryDownscale: true,
  tryDenoise: true,
  maxNumberOfSymbols: 8,
};

function firstText(results) {
  return results?.find((item) => typeof item?.text === 'string' && item.text.trim())?.text?.trim() || null;
}

async function decodeZxing(image) {
  try {
    return firstText(await readBarcodes(image, ZXING_OPTIONS));
  } catch {
    return null;
  }
}

async function decodeZbar(image) {
  try {
    const { data, info } = await sharp(image, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .flatten({ background: '#ffffff' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const bytes = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const symbols = await scanGrayBuffer(bytes, info.width, info.height);
    for (const symbol of symbols) {
      const text = symbol.decode('utf-8')?.trim();
      if (text) return text;
    }
  } catch {
    // This variant may be unsupported by ZBar; the next decoder/variant can still work.
  }
  return null;
}

async function decode(image) {
  return (await decodeZxing(image)) || (await decodeZbar(image));
}

class QRCodeParser {
  async parse(input, imageUrl) {
    try {
      const buffer = Buffer.isBuffer(input) ? input : await this.toBuffer(imageUrl, input);
      const originalMetadata = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();
      const base = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .flatten({ background: '#ffffff' })
        .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();

      const direct = await decode(base);
      if (direct) return this.success(direct, '原图');

      // Full-screen screenshots can shrink a small QR too much. Scan overlapping crops
      // from the original image before applying stronger pixel transforms.
      const originalWidth = originalMetadata.width || 0;
      const originalHeight = originalMetadata.height || 0;
      if (Math.max(originalWidth, originalHeight) > MAX_SIDE && originalWidth > 1 && originalHeight > 1) {
        const cropWidth = Math.ceil(originalWidth * 0.62);
        const cropHeight = Math.ceil(originalHeight * 0.62);
        const positions = [
          ['中心裁切', Math.floor((originalWidth - cropWidth) / 2), Math.floor((originalHeight - cropHeight) / 2)],
          ['左上裁切', 0, 0],
          ['右上裁切', originalWidth - cropWidth, 0],
          ['左下裁切', 0, originalHeight - cropHeight],
          ['右下裁切', originalWidth - cropWidth, originalHeight - cropHeight],
        ];
        for (const [label, left, top] of positions) {
          try {
            const crop = await sharp(buffer, { limitInputPixels: MAX_INPUT_PIXELS })
              .rotate()
              .extract({ left: Math.max(0, left), top: Math.max(0, top), width: Math.min(cropWidth, originalWidth - left), height: Math.min(cropHeight, originalHeight - top) })
              .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
              .png()
              .toBuffer();
            const text = await decode(crop);
            if (text) return this.success(text, label);
          } catch {
            // A crop outside an image's valid orientation is skipped.
          }
        }
      }

      const metadata = await sharp(base).metadata();
      const width = metadata.width || 0;
      const height = metadata.height || 0;
      const side = Math.min(width, height);
      const margin = Math.max(12, Math.round(side * 0.06));
      const variants = [
        ['补白边', () => sharp(base).extend({ top: margin, bottom: margin, left: margin, right: margin, background: '#ffffff' }).png().toBuffer()],
        ['灰度增强', () => sharp(base).greyscale().normalize().sharpen({ sigma: 1.1 }).png().toBuffer()],
        ['灰度增强补边', () => sharp(base).greyscale().normalize().sharpen({ sigma: 1.1 }).extend({ top: margin, bottom: margin, left: margin, right: margin, background: '#ffffff' }).png().toBuffer()],
        ...[96, 128, 160, 192, 224].map((threshold) => [
          `阈值${threshold}`,
          () => sharp(base).greyscale().normalize().threshold(threshold).png().toBuffer(),
        ]),
        ['反色', () => sharp(base).greyscale().normalize().negate().png().toBuffer()],
      ];

      if (side > 0 && side < 900) {
        const scale = Math.min(3, Math.ceil(900 / side));
        variants.push([
          `放大${scale}倍`,
          () => sharp(base).resize({ width: Math.min(width * scale, MAX_SIDE), height: Math.min(height * scale, MAX_SIDE), fit: 'inside' }).png().toBuffer(),
        ]);
      }

      for (const angle of [-15, -8, 8, 15]) {
        variants.push([
          `旋转${angle}度`,
          () => sharp(base).rotate(angle, { background: '#ffffff' }).png().toBuffer(),
        ]);
      }

      for (const [label, create] of variants) {
        try {
          const candidate = await create();
          const text = await decode(candidate);
          if (text) return this.success(text, label);
        } catch {
          // Ignore a failed transform and continue with the remaining strategies.
        }
      }

      return { code: 1, msg: '未检测到二维码；已尝试双引擎、补边、增强、反色、阈值化、放大及旋转', data: null };
    } catch (error) {
      logger.warn('[鸣潮扫码登录] 二维码解码失败:', error.message);
      return { code: 2, msg: `解码失败: ${error.message}`, data: null };
    }
  }

  success(text, method) {
    logger.mark(`[鸣潮扫码登录] 二维码识别成功（${method}）`);
    return { code: 0, msg: '识别成功', data: text, Result: [{ text, method }] };
  }

  async toBuffer(input, base64) {
    if (Buffer.isBuffer(input)) return input;
    const value = base64 || input;
    if (typeof value !== 'string' || !value) throw new Error('没有提供二维码图片');
    if (/^data:[^;]+;base64,/i.test(value)) {
      return Buffer.from(value.replace(/^data:[^;]+;base64,/i, ''), 'base64');
    }
    if (/^https?:\/\//i.test(value)) {
      const response = await fetch(value, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`图片下载失败: HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    }
    try {
      return await fs.readFile(path.resolve(value));
    } catch (error) {
      throw new Error(`读取图片失败: ${error.message}`);
    }
  }
}

export default QRCodeParser;
