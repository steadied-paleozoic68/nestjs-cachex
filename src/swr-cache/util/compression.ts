import { compress, decompress } from '@mongodb-js/zstd';
import { pack, unpack } from 'msgpackr';

import type { CompressionConfig } from '../core';
import { DEFAULT_CONFIG } from '../core';

const COMPRESSED_PREFIX = '__ZS__';

export interface CompressionResult {
  data: string;
  compressed: boolean;
}

/**
 * 압축된 데이터인지 Prefix로 확인
 */
function isCompressed(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  return value.startsWith(COMPRESSED_PREFIX);
}

/**
 * 데이터 저장 (직렬화 및 필요 시 압축)
 */
export async function compressIfNeeded(
  value: unknown,
  config?: CompressionConfig,
): Promise<CompressionResult> {
  const enabled = config?.enabled ?? DEFAULT_CONFIG.compression.enabled;
  const threshold = config?.threshold ?? DEFAULT_CONFIG.compression.threshold;
  const level = config?.level ?? DEFAULT_CONFIG.compression.level;

  // 바이너리로 직렬화
  const packedBuffer = pack(value);

  // 압축 비활성화 또는 임계값 미만인 경우 압축 없이 Base64 변환
  if (!enabled || packedBuffer.length < threshold) {
    return {
      data: packedBuffer.toString('base64'),
      compressed: false,
    };
  }

  try {
    // 임계값 이상인 경우 압축
    const compressedBuffer = await compress(packedBuffer, level);

    return {
      data: COMPRESSED_PREFIX + compressedBuffer.toString('base64'),
      compressed: true,
    };
  } catch {
    // 실패 시 원본 저장
    return {
      data: packedBuffer.toString('base64'),
      compressed: false,
    };
  }
}

/**
 * 데이터 조회 (압축 해제 및 역직렬화)
 */
export async function decompressIfNeeded<T>(value: unknown): Promise<T> {
  if (typeof value !== 'string') {
    return value as T;
  }

  // 압축된 데이터인 경우
  if (isCompressed(value)) {
    const compressedBase64 = value.slice(COMPRESSED_PREFIX.length);
    const compressedBuffer = Buffer.from(compressedBase64, 'base64');
    const decompressedBuffer = await decompress(compressedBuffer);

    return unpack(decompressedBuffer) as T;
  }

  try {
    // 기존 JSON 데이터인 경우
    return JSON.parse(value) as T;
  } catch {
    // 압축 안 된 MsgPack 데이터인 경우
    try {
      const buffer = Buffer.from(value, 'base64');
      return unpack(buffer) as T;
    } catch {
      // 둘 다 아니면 원본 반환
      return value as unknown as T;
    }
  }
}
