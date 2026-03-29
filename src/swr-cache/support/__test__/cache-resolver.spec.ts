import { Logger } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { CACHE_MODULE_CONFIG, CacheManager } from '../../core/types';
import { InMemoryCache } from '../../provider/memory-cache';
import { MultiCache } from '../../provider/multi-cache';
import { RedisCache } from '../../provider/redis-cache';
import { CacheResolver } from '../cache-resolver';

describe('CacheResolver', () => {
  let cacheResolver: CacheResolver;
  let mockRedisCache: RedisCache;
  let mockInMemoryCache: InMemoryCache;
  let mockMultiCache: MultiCache;
  let mockLoggerWarn: jest.SpyInstance;

  const createMockCacheProvider = () => ({
    get: jest.fn(),
    put: jest.fn(),
    evict: jest.fn(),
  });

  describe('모든 프로바이더가 주입된 경우', () => {
    beforeEach(async () => {
      mockRedisCache = createMockCacheProvider() as any;
      mockInMemoryCache = createMockCacheProvider() as any;
      mockMultiCache = createMockCacheProvider() as any;

      // Logger Mocking
      mockLoggerWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CacheResolver,
          { provide: CACHE_MODULE_CONFIG, useValue: {} },
          { provide: RedisCache, useValue: mockRedisCache },
          { provide: InMemoryCache, useValue: mockInMemoryCache },
          { provide: MultiCache, useValue: mockMultiCache },
        ],
      }).compile();

      cacheResolver = module.get<CacheResolver>(CacheResolver);

      // onModuleInit 수동 호출 (TestingModule은 앱 초기화 시 호출하지만 단위 테스트에선 명시적으로 호출 필요할 수 있음)
      await cacheResolver.onModuleInit();
    });

    afterEach(() => {
      jest.clearAllMocks();
    });

    describe('onModuleInit', () => {
      it('주입된 모든 캐시 프로바이더를 등록해야 한다', () => {
        // 내부 private map 상태를 직접 확인할 수 없으므로, get()을 통해 간접 확인
        expect(cacheResolver.get(CacheManager.REDIS)).toBe(mockRedisCache);
        expect(cacheResolver.get(CacheManager.MEMORY)).toBe(mockInMemoryCache);
        expect(cacheResolver.get(CacheManager.MULTI)).toBe(mockMultiCache);
      });

      it('프로바이더가 존재하므로 경고 로그를 출력하지 않아야 한다', () => {
        expect(mockLoggerWarn).not.toHaveBeenCalled();
      });
    });

    describe('get', () => {
      it('CacheManager.REDIS 요청 시 RedisCache를 반환해야 한다', () => {
        const result = cacheResolver.get(CacheManager.REDIS);
        expect(result).toBe(mockRedisCache);
      });

      it('CacheManager.MEMORY 요청 시 InMemoryCache를 반환해야 한다', () => {
        const result = cacheResolver.get(CacheManager.MEMORY);
        expect(result).toBe(mockInMemoryCache);
      });

      it('CacheManager.MULTI 요청 시 MultiCache를 반환해야 한다', () => {
        const result = cacheResolver.get(CacheManager.MULTI);
        expect(result).toBe(mockMultiCache);
      });

      it('인자 없이 호출하면 기본값으로 RedisCache를 반환해야 한다', () => {
        const result = cacheResolver.get();
        expect(result).toBe(mockRedisCache);
      });
    });
  });

  describe('일부 프로바이더만 주입된 경우', () => {
    beforeEach(async () => {
      mockInMemoryCache = createMockCacheProvider() as any;
      mockLoggerWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          CacheResolver,
          { provide: CACHE_MODULE_CONFIG, useValue: {} },
          { provide: InMemoryCache, useValue: mockInMemoryCache },
        ],
      }).compile();

      cacheResolver = module.get<CacheResolver>(CacheResolver);
      await cacheResolver.onModuleInit();
    });

    it('MemoryCache는 정상적으로 조회되어야 한다', () => {
      expect(cacheResolver.get(CacheManager.MEMORY)).toBe(mockInMemoryCache);
    });

    it('등록되지 않은 RedisCache 요청 시 에러를 던져야 한다', () => {
      expect(() => cacheResolver.get(CacheManager.REDIS)).toThrow(
        `캐시 프로바이더를 찾을 수 없습니다: ${CacheManager.REDIS}`,
      );
    });

    it('기본값(REDIS) 요청 시에도 등록되어 있지 않으면 에러를 던져야 한다', () => {
      expect(() => cacheResolver.get()).toThrow(
        `캐시 프로바이더를 찾을 수 없습니다: ${CacheManager.REDIS}`,
      );
    });
  });

  describe('프로바이더가 하나도 없는 경우', () => {
    beforeEach(async () => {
      mockLoggerWarn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

      const module: TestingModule = await Test.createTestingModule({
        providers: [CacheResolver, { provide: CACHE_MODULE_CONFIG, useValue: {} }],
      }).compile();

      cacheResolver = module.get<CacheResolver>(CacheResolver);
      await cacheResolver.onModuleInit();
    });

    it('초기화 시 경고 로그를 출력해야 한다', () => {
      expect(mockLoggerWarn).toHaveBeenCalledWith('구성된 캐시 프로바이더가 없습니다.');
    });

    it('어떤 프로바이더를 요청해도 에러를 던져야 한다', () => {
      expect(() => cacheResolver.get(CacheManager.MEMORY)).toThrow();
      expect(() => cacheResolver.get(CacheManager.REDIS)).toThrow();
      expect(() => cacheResolver.get(CacheManager.MULTI)).toThrow();
    });
  });
});
