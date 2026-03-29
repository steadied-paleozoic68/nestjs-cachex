import type { InjectionToken, ModuleMetadata, OptionalFactoryDependency } from '@nestjs/common';

import type { CacheProvider } from './cache-provider';

export enum CacheManager {
  REDIS = 'REDIS',
  MEMORY = 'MEMORY',
  MULTI = 'MULTI',
}

export type CacheableNameResolver = string | ((...args: any[]) => string);
export type CacheEvictNameResolver = string | string[] | ((...args: any[]) => string | string[]);
export type CacheKeyResolver = string | ((...args: any[]) => string);

export type CacheableContext = {
  readonly key: string;
  readonly method: (...args: unknown[]) => unknown;
  readonly args: unknown[];
  readonly cacheProvider: CacheProvider;
};

export type CacheEvictContext = {
  keys: string[];
  cacheProvider: CacheProvider;
  allEntries?: boolean;
};

export type CacheKeyContext = {
  target: any;
  methodName: string;
  args: any[];
};

export type CacheOperationContext = {
  method: (...args: any[]) => any;
  instance: any;
  methodName: string;
  args: any[];
};

/**
 * 캐시 설정 값 정의
 */
export const CACHE_MODULE_CONFIG = 'CACHE_MODULE_CONFIG';
export const SWR_REDIS_CLIENT = Symbol('SWR_REDIS_CLIENT');
export const SWR_REDIS_SUBSCRIBER = Symbol('SWR_REDIS_SUBSCRIBER');

/**
 * Redis 클라이언트 인터페이스
 * ioredis, redis 등 어떤 클라이언트든 이 인터페이스를 구현하면 사용 가능
 */
export interface RedisLike {
  ping(): Promise<string>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: (string | number)[]): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  scan(
    cursor: string | number,
    ...args: (string | number)[]
  ): Promise<[cursor: string, keys: string[]]>;
  unlink(...keys: string[]): Promise<number>;
  /**
   * Pub/Sub 알림 발행 (선택적 — 없으면 notifyResult는 no-op)
   * SUBSCRIBE 모드가 아닌 일반 커넥션에서 호출
   */
  publish?(channel: string, message: string): Promise<number>;
}

/**
 * Redis Subscriber 커넥션 인터페이스
 * ioredis는 SUBSCRIBE 실행 시 해당 커넥션이 구독 전용 모드로 전환되므로
 * 일반 명령(GET/SET 등)을 실행할 수 없음 — 반드시 별도 커넥션 사용
 */
export interface RedisSubscriberLike {
  subscribe(channel: string): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  on(event: 'message', listener: (channel: string, message: string) => void): this;
  off(event: 'message', listener: (channel: string, message: string) => void): this;
}

/**
 * SWR 설정
 */
export interface SwrConfig {
  /**
   * SWR 활성화 여부
   * @default true
   */
  enabled?: boolean;

  /**
   * staleTtl 미설정 시 ttl에 곱할 기본 배수
   * physicalTtl = ttl + (ttl * defaultStaleMultiplier)
   * @default 5
   * @example defaultStaleMultiplier: 5 // ttl: 60 → staleTtl: 300, physicalTtl: 360
   */
  defaultStaleMultiplier?: number;

  /**
   * Pub/Sub 대기 타임아웃 (ms)
   * 락 실패 시 Redis SUBSCRIBE로 결과를 기다리는 최대 시간
   * 타임아웃 초과 시 폴링 방식으로 폴백
   * @default 2000
   */
  pubSubTimeoutMs?: number;
}

/**
 * 압축 설정
 */
export interface CompressionConfig {
  enabled?: boolean;
  threshold?: number;
  level?: number;
}

/**
 * MultiCache L1/L2 설정
 */
export interface MultiCacheConfig {
  l1MaxTtl?: number;
  l2DefaultTtl?: number;
  writeBackTtl?: number;
}

/**
 * 메모리 캐시 설정
 */
export interface MemoryCacheConfig {
  max?: number;
  ttl?: number;
}

/**
 * 글로벌 기본값 설정
 */
export interface DefaultsConfig {
  ttl?: number;
  cacheManager?: CacheManager;
}

/**
 * 기본값 상수
 */
export const DEFAULT_CONFIG = {
  memory: {
    max: 1000,
    ttl: 3600000,
  },
  multi: {
    l1MaxTtl: 300,
    l2DefaultTtl: 60,
    writeBackTtl: 60,
  },
  compression: {
    enabled: true,
    threshold: 20 * 1024,
    level: 3,
  },
  swr: {
    enabled: true,
    defaultStaleMultiplier: 5,
    maxAttempts: 10,
    baseDelayMs: 20,
    maxDelayMs: 200,
    jitterMs: 10,
    pubSubTimeoutMs: 2000,
  },
} as const;

export interface CacheModuleConfig {
  defaults?: DefaultsConfig;
  memory?: MemoryCacheConfig;
  multi?: MultiCacheConfig;
  compression?: CompressionConfig;
  swr?: SwrConfig;
}

export interface CacheModuleAsyncConfig extends Pick<ModuleMetadata, 'imports'> {
  redisToken?: InjectionToken;
  /**
   * Redis SUBSCRIBE 전용 커넥션 토큰
   * ioredis는 SUBSCRIBE 후 일반 명령 불가 — 반드시 별도 커넥션 제공
   * 미설정 시 pub/sub 비활성화, 기존 폴링 방식으로 동작
   * @example
   * subscriberToken: REDIS_SUBSCRIBER // { provide: REDIS_SUBSCRIBER, useFactory: () => new Redis() }
   */
  subscriberToken?: InjectionToken;
  inject?: InjectionToken[] | OptionalFactoryDependency[];
  useFactory: (...args: any[]) => Promise<CacheModuleConfig> | CacheModuleConfig;
}
