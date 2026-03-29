import { Injectable } from '@nestjs/common';
import { pack } from 'msgpackr';
import * as XXH from 'xxhashjs';

import type { CacheableOption, CacheEvictOption, CacheKeyContext } from '../core';

@Injectable()
export class CacheKeyGenerator {
  /**
   * @Cacheable용 캐시 키 생성
   */
  generateCacheableKey(option: CacheableOption, context: CacheKeyContext): string {
    const { name } = option;

    const namespace = name
      ? typeof name === 'function'
        ? name(...context.args)
        : name
      : undefined;
    const key = this.resolveKey(option.key, context);

    return namespace ? `${namespace}::${key}` : key;
  }

  /**
   * @CacheEvict용 캐시 키 생성
   */
  generateEvictKeys(option: CacheEvictOption, context: CacheKeyContext): string[] {
    const { name } = option;

    const namespaces = name
      ? (() => {
          const resolved = typeof name === 'function' ? name(...context.args) : name;
          return Array.isArray(resolved) ? resolved.filter(Boolean) : [resolved];
        })()
      : [];

    if (option.allEntries) {
      return namespaces.map((ns) => `${ns}::`);
    }

    const key = this.resolveKey(option.key, context);

    return namespaces.length === 0 ? [key] : namespaces.map((ns) => `${ns}::${key}`);
  }

  /**
   * 커스텀 키 리졸버 또는 기본 키 제너레이터를 사용해 캐시 키를 생성합니다.
   */
  private resolveKey(
    resolver: string | ((...args: any[]) => string) | undefined,
    context: CacheKeyContext,
  ): string {
    // 커스텀 키 리졸버가 있는 경우 우선 사용
    if (resolver) {
      const resolved = typeof resolver === 'function' ? resolver(...context.args) : resolver;

      if (resolved) {
        return resolved;
      }
    }

    // 커스텀 키가 없으면 기본 키 생성
    return this.generateAutoKey(context);
  }

  /**
   * 자동 캐시 키를 생성합니다.
   * 클래스명:메서드명 또는 클래스명:메서드명:파라미터해시 형태
   */
  private generateAutoKey(context: CacheKeyContext): string {
    const { target, methodName, args } = context;
    const className = target?.constructor?.name;
    const prefix = className ? `${className}:${methodName}` : methodName;

    // 인자가 없는 경우
    if (args.length === 0) {
      return prefix;
    }

    // 인자가 1개이고 원시 타입인 경우
    if (args.length === 1) {
      const arg = args[0];

      if (this.isPrimitive(arg)) {
        return `${prefix}:${arg}`;
      }
    }

    // 복잡한 경우 해시 사용
    return this.generateHashedKey(prefix, args);
  }

  /**
   * 값이 원시 타입인지 확인
   */
  private isPrimitive(value: unknown): boolean {
    return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
  }

  /**
   * 해시를 사용한 키 생성
   * MessagePack을 사용하여 JSON.stringify보다 빠르고 컴팩트한 직렬화
   */
  private generateHashedKey(prefix: string, args: any[]): string {
    const packedBuffer = pack(args);
    const hash = XXH.h32(packedBuffer, 0x654c6162).toString(16);

    return `${prefix}:${hash}`;
  }
}
