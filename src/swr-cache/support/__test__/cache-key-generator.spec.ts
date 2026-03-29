import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import type { CacheableOption, CacheEvictOption, CacheKeyContext } from '../../core';
import { CacheKeyGenerator } from '../cache-key-generator';

describe('CacheKeyGenerator', () => {
  let keyGenerator: CacheKeyGenerator;

  class TestService {
    testMethod() {}
  }

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [CacheKeyGenerator],
    }).compile();

    keyGenerator = module.get<CacheKeyGenerator>(CacheKeyGenerator);
  });

  it('init', () => {
    expect(keyGenerator).toBeDefined();
  });

  describe('generateCacheableKey', () => {
    let target: TestService;
    const methodName = 'testMethod';
    const className = 'TestService';

    beforeEach(() => {
      target = new TestService();
    });

    it('name과 key가 없으면 자동 생성된 키를 반환해야 한다', () => {
      const option: CacheableOption = { ttl: 60 };
      const context: CacheKeyContext = { target, methodName, args: [] };

      const result = keyGenerator.generateCacheableKey(option, context);

      expect(result).toBe(`${className}:${methodName}`);
    });

    it('name만 있으면 "name::자동키" 형태를 반환해야 한다', () => {
      const option: CacheableOption = { ttl: 60, name: 'users' };
      const context: CacheKeyContext = { target, methodName, args: [] };

      const result = keyGenerator.generateCacheableKey(option, context);

      expect(result).toBe(`users::${className}:${methodName}`);
    });

    it('key만 있으면 해당 키를 반환해야 한다', () => {
      const option: CacheableOption = { ttl: 60, key: 'custom-key' };
      const context: CacheKeyContext = { target, methodName, args: [] };

      const result = keyGenerator.generateCacheableKey(option, context);

      expect(result).toBe('custom-key');
    });

    it('name과 key 모두 있으면 "name::key" 형태를 반환해야 한다', () => {
      const option: CacheableOption = { ttl: 60, name: 'users', key: 'user-123' };
      const context: CacheKeyContext = { target, methodName, args: [] };

      const result = keyGenerator.generateCacheableKey(option, context);

      expect(result).toBe('users::user-123');
    });

    it('name이 함수이면 args를 전달하여 평가해야 한다', () => {
      const option: CacheableOption = {
        ttl: 60,
        name: (id: string) => `user-${id}`,
        key: 'profile',
      };
      const context: CacheKeyContext = { target, methodName, args: ['123'] };

      const result = keyGenerator.generateCacheableKey(option, context);

      expect(result).toBe('user-123::profile');
    });

    it('key가 함수이면 args를 전달하여 평가해야 한다', () => {
      const option: CacheableOption = {
        ttl: 60,
        name: 'users',
        key: (id: string) => `user-${id}`,
      };
      const context: CacheKeyContext = { target, methodName, args: ['456'] };

      const result = keyGenerator.generateCacheableKey(option, context);

      expect(result).toBe('users::user-456');
    });

    it('파라미터가 1개이고 원시 타입이면 "클래스명:메서드명:값"을 반환해야 한다', () => {
      const option: CacheableOption = { ttl: 60 };
      const context: CacheKeyContext = { target, methodName, args: ['hello'] };

      const result = keyGenerator.generateCacheableKey(option, context);

      expect(result).toBe(`${className}:${methodName}:hello`);
    });

    it('파라미터가 여러 개이면 해시된 키를 반환해야 한다', () => {
      const option: CacheableOption = { ttl: 60 };
      const context: CacheKeyContext = { target, methodName, args: ['a', 'b', 'c'] };

      const result = keyGenerator.generateCacheableKey(option, context);

      expect(result).toMatch(new RegExp(`^${className}:${methodName}:[a-f0-9]+$`));
    });

    it('동일한 파라미터에 대해서는 항상 동일한 키를 반환해야 한다', () => {
      const option: CacheableOption = { ttl: 60 };
      const context1: CacheKeyContext = { target, methodName, args: [{ a: 1 }] };
      const context2: CacheKeyContext = { target, methodName, args: [{ a: 1 }] };

      const result1 = keyGenerator.generateCacheableKey(option, context1);
      const result2 = keyGenerator.generateCacheableKey(option, context2);

      expect(result1).toBe(result2);
    });
  });

  describe('generateEvictKeys', () => {
    let target: TestService;
    const methodName = 'testMethod';

    beforeEach(() => {
      target = new TestService();
    });

    it('allEntries가 true이면 "name::" 패턴을 반환해야 한다', () => {
      const option: CacheEvictOption = { name: 'users', allEntries: true };
      const context: CacheKeyContext = { target, methodName, args: [] };

      const result = keyGenerator.generateEvictKeys(option, context);

      expect(result).toEqual(['users::']);
    });

    it('allEntries가 true이고 name이 배열이면 여러 패턴을 반환해야 한다', () => {
      const option: CacheEvictOption = { name: ['users', 'profiles'], allEntries: true };
      const context: CacheKeyContext = { target, methodName, args: [] };

      const result = keyGenerator.generateEvictKeys(option, context);

      expect(result).toEqual(['users::', 'profiles::']);
    });

    it('allEntries가 false이면 "name::key" 형태를 반환해야 한다', () => {
      const option: CacheEvictOption = { name: 'users', key: 'user-123' };
      const context: CacheKeyContext = { target, methodName, args: [] };

      const result = keyGenerator.generateEvictKeys(option, context);

      expect(result).toEqual(['users::user-123']);
    });

    it('name이 배열이면 각각에 대해 키를 생성해야 한다', () => {
      const option: CacheEvictOption = { name: ['users', 'profiles'], key: 'id-123' };
      const context: CacheKeyContext = { target, methodName, args: [] };

      const result = keyGenerator.generateEvictKeys(option, context);

      expect(result).toEqual(['users::id-123', 'profiles::id-123']);
    });

    it('name이 함수이면 args를 전달하여 평가해야 한다', () => {
      const option: CacheEvictOption = {
        name: (id: string) => `user-${id}`,
        key: 'profile',
      };
      const context: CacheKeyContext = { target, methodName, args: ['789'] };

      const result = keyGenerator.generateEvictKeys(option, context);

      expect(result).toEqual(['user-789::profile']);
    });

    it('name이 없고 allEntries가 아니면 key만 반환해야 한다', () => {
      const option: CacheEvictOption = { key: 'standalone-key' };
      const context: CacheKeyContext = { target, methodName, args: [] };

      const result = keyGenerator.generateEvictKeys(option, context);

      expect(result).toEqual(['standalone-key']);
    });
  });
});
