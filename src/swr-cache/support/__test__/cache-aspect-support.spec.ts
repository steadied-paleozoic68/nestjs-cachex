import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import type { CacheableOption, CacheEvictOption, CacheOperationContext } from '../../core';
import { CacheManager } from '../../core';
import { CacheAspectSupport } from '../cache-aspect-support';
import { CacheKeyGenerator } from '../cache-key-generator';
import { CacheOperations } from '../cache-operations';
import { CacheResolver } from '../cache-resolver';

describe('CacheAspectSupport', () => {
  let aspectSupport: CacheAspectSupport;
  let mockCacheResolver: jest.Mocked<CacheResolver>;
  let mockCacheKeyGenerator: jest.Mocked<CacheKeyGenerator>;
  let mockCacheOperations: jest.Mocked<CacheOperations>;
  let mockCacheProvider: any;

  const createParams = (
    methodName = 'testMethod',
    args: any[] = ['arg1'],
  ): CacheOperationContext => ({
    instance: {},
    method: jest.fn().mockResolvedValue('original-result'),
    methodName,
    args,
  });

  beforeEach(async () => {
    mockCacheProvider = { name: 'MockProvider' };

    mockCacheResolver = {
      get: jest.fn().mockReturnValue(mockCacheProvider),
    } as any;

    mockCacheKeyGenerator = {
      generateCacheableKey: jest.fn().mockReturnValue('generated-key'),
      generateEvictKeys: jest.fn().mockReturnValue(['generated-key']),
    } as any;

    mockCacheOperations = {
      getWithSwr: jest.fn().mockResolvedValue('cached-result'),
      bulkEvict: jest.fn().mockResolvedValue(undefined),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheAspectSupport,
        { provide: CacheResolver, useValue: mockCacheResolver },
        { provide: CacheKeyGenerator, useValue: mockCacheKeyGenerator },
        { provide: CacheOperations, useValue: mockCacheOperations },
      ],
    }).compile();

    aspectSupport = module.get<CacheAspectSupport>(CacheAspectSupport);
  });

  describe('executeCacheable', () => {
    it('condition 조건이 false면 캐시 로직을 건너뛰고 원본 메서드를 실행해야 한다', async () => {
      // Arrange
      const option: CacheableOption = {
        ttl: 60,
        condition: (arg) => arg === 'valid',
      };
      const params = createParams('test', ['invalid']);

      // Act
      const result = await aspectSupport.executeCacheable(option, params);

      // Assert
      expect(result).toBe('original-result');
      expect(params.method).toHaveBeenCalledWith('invalid');
      expect(mockCacheOperations.getWithSwr).not.toHaveBeenCalled();
    });

    it('condition 조건이 true면 캐시 오퍼레이션을 실행해야 한다', async () => {
      const option: CacheableOption = {
        ttl: 60,
        condition: (arg) => arg === 'valid',
      };
      const params = createParams('test', ['valid']);

      const result = await aspectSupport.executeCacheable(option, params);

      expect(result).toBe('cached-result');
      expect(mockCacheOperations.getWithSwr).toHaveBeenCalled();
    });

    it('CacheKeyGenerator.generateCacheableKey를 호출하여 키를 생성해야 한다', async () => {
      const option: CacheableOption = { ttl: 60 };
      const params = createParams();

      await aspectSupport.executeCacheable(option, params);

      expect(mockCacheKeyGenerator.generateCacheableKey).toHaveBeenCalledWith(
        option,
        expect.objectContaining({
          target: params.instance,
          methodName: params.methodName,
          args: params.args,
        }),
      );
      expect(mockCacheOperations.getWithSwr).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'generated-key' }),
        option,
      );
    });

    it('지정된 CacheManager를 Resolver에서 가져와야 한다', async () => {
      const option: CacheableOption = {
        ttl: 60,
        cacheManager: CacheManager.REDIS,
      };
      const params = createParams();

      await aspectSupport.executeCacheable(option, params);

      expect(mockCacheResolver.get).toHaveBeenCalledWith(CacheManager.REDIS);
      expect(mockCacheOperations.getWithSwr).toHaveBeenCalledWith(
        expect.objectContaining({ cacheProvider: mockCacheProvider }),
        option,
      );
    });
  });

  describe('executeCacheEvict', () => {
    it('condition 조건이 false면 삭제 로직을 건너뛰어야 한다', async () => {
      const option: CacheEvictOption = {
        condition: () => false,
      };
      const params = createParams();

      const result = await aspectSupport.executeCacheEvict(option, params);

      expect(result).toBe('original-result');
      expect(mockCacheOperations.bulkEvict).not.toHaveBeenCalled();
    });

    it('원본 메서드 실행 후에 캐시를 삭제해야 한다', async () => {
      const option: CacheEvictOption = {};
      const params = createParams();

      await aspectSupport.executeCacheEvict(option, params);

      // 순서 검증: 메서드 호출 -> 삭제
      expect(params.method).toHaveBeenCalled();
      expect(mockCacheOperations.bulkEvict).toHaveBeenCalled();
    });

    it('CacheKeyGenerator.generateEvictKeys를 호출하여 키를 생성해야 한다', async () => {
      const option: CacheEvictOption = {
        name: 'users',
      };
      const params = createParams('test', ['user-1']);
      mockCacheKeyGenerator.generateEvictKeys.mockReturnValue(['users::generated-key']);

      await aspectSupport.executeCacheEvict(option, params);

      expect(mockCacheKeyGenerator.generateEvictKeys).toHaveBeenCalledWith(
        option,
        expect.objectContaining({
          target: params.instance,
          methodName: params.methodName,
          args: params.args,
        }),
      );
      expect(mockCacheOperations.bulkEvict).toHaveBeenCalledWith(
        expect.objectContaining({
          keys: ['users::generated-key'],
        }),
      );
    });

    it('beforeInvocation이 true면 원본 메서드 실행 전에 삭제해야 한다', async () => {
      const option: CacheEvictOption = {
        beforeInvocation: true,
      };
      const params = createParams();

      // 실행 순서를 확인하기 위해 mock 구현 변경
      const executionOrder: string[] = [];
      mockCacheOperations.bulkEvict.mockImplementation(async () => {
        executionOrder.push('evict');
      });

      (params.method as jest.Mock).mockImplementation(async () => {
        executionOrder.push('method');
        return 'result';
      });

      await aspectSupport.executeCacheEvict(option, params);

      expect(executionOrder).toEqual(['evict', 'method']);
    });

    it('allEntries 옵션이 context에 전달되어야 한다', async () => {
      const option: CacheEvictOption = {
        name: 'products',
        allEntries: true,
      };
      const params = createParams();
      mockCacheKeyGenerator.generateEvictKeys.mockReturnValue(['products::']);

      await aspectSupport.executeCacheEvict(option, params);

      expect(mockCacheOperations.bulkEvict).toHaveBeenCalledWith(
        expect.objectContaining({
          keys: ['products::'],
          allEntries: true,
        }),
      );
    });
  });
});
