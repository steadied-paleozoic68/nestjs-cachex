import { Logger } from '@nestjs/common';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import type {
  CacheableContext,
  CacheableOption,
  CacheEvictContext,
  CacheProvider,
} from '../../core';
import { CACHE_MODULE_CONFIG, CacheEnvelope } from '../../core';
import { CacheOperations } from '../cache-operations';

describe('CacheOperations', () => {
  let cacheOperations: CacheOperations;
  let mockCacheProvider: jest.Mocked<CacheProvider>;
  let mockMethod: jest.Mock;

  const createContext = (key = 'test-key'): CacheableContext => ({
    key,
    method: mockMethod,
    args: ['arg1', 'arg2'],
    cacheProvider: mockCacheProvider,
  });

  const createOption = (ttl = 60, unless?: (result: any) => boolean): CacheableOption => ({
    ttl,
    unless,
  });

  // Promise 큐를 비우는 헬퍼
  const flushPromises = async () => {
    // 마이크로태스크 큐 처리
    await new Promise((resolve) => process.nextTick(resolve));
    // 매크로태스크 처리 (Real Timer 사용 시 동작)
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => process.nextTick(resolve));
  };

  // 타이머 진행 헬퍼
  const flushPromisesAndTimers = async (ms = 1000) => {
    jest.advanceTimersByTime(ms);
    await flushPromises();
  };

  beforeEach(async () => {
    mockCacheProvider = {
      ping: jest.fn(),
      tryLock: jest.fn(),
      unlock: jest.fn(),
      get: jest.fn(),
      put: jest.fn(),
      evict: jest.fn(),
      clear: jest.fn(),
      clearKeysByPattern: jest.fn(),
    };

    mockMethod = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CacheOperations,
        {
          provide: CACHE_MODULE_CONFIG,
          useValue: {},
        },
      ],
    }).compile();

    cacheOperations = module.get<CacheOperations>(CacheOperations);

    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('getWithSwr', () => {
    describe('Cache Miss (데이터 없음)', () => {
      it('캐시가 없으면 락을 획득하고 원본 메서드를 실행한 뒤 캐시를 저장해야 한다', async () => {
        const context = createContext();
        const option = createOption();
        const expectedResult = { data: 'result' };

        mockCacheProvider.get.mockResolvedValue(null);
        mockCacheProvider.tryLock.mockResolvedValue(true);
        mockMethod.mockResolvedValue(expectedResult);

        const result = await cacheOperations.getWithSwr(context, option);

        expect(result).toEqual(expectedResult);
        expect(mockCacheProvider.get).toHaveBeenCalledWith('test-key');
        expect(mockCacheProvider.tryLock).toHaveBeenCalledWith('test-key');
        expect(mockMethod).toHaveBeenCalled();
        expect(mockCacheProvider.put).toHaveBeenCalled();
        expect(mockCacheProvider.unlock).toHaveBeenCalledWith('test-key');
      });

      it('락 획득 실패 시 폴링하며, 그 사이 캐시가 생성되면 캐시 데이터를 반환해야 한다', async () => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });

        const context = createContext();
        const option = createOption();
        const cachedData = { data: 'cached-result' };
        const envelope = CacheEnvelope.create(cachedData, option.ttl!);

        // [Mock 시나리오]
        // tryLock(false) → pub/sub 없음 → 폴링 폴백
        // 폴링 0회차: delay → get(null)
        // 폴링 1회차: delay → get(Data) → 캐시 발견 → 반환
        mockCacheProvider.tryLock.mockResolvedValue(false);

        mockCacheProvider.get
          .mockResolvedValueOnce(null) // getWithSwr 초기 체크
          .mockResolvedValueOnce(null) // 폴링 attempt 0
          .mockResolvedValueOnce(envelope.toObject()); // 폴링 attempt 1 → 캐시 발견

        const resultPromise = cacheOperations.getWithSwr(context, option);

        await flushPromisesAndTimers(10000); // 폴링 delay 0
        await flushPromisesAndTimers(10000); // 폴링 delay 1 → 캐시 발견
        await flushPromisesAndTimers(10000); // 최종 Promise 처리

        const result = await resultPromise;

        expect(result).toEqual(cachedData);
        expect(mockMethod).not.toHaveBeenCalled();
        expect(mockCacheProvider.tryLock).toHaveBeenCalledTimes(1);
      });

      it('최대 재시도 횟수(10회)를 초과하면 락 없이 원본 메서드를 실행해야 한다', async () => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });

        const context = createContext();
        const option = createOption();
        const expectedResult = { data: 'fallback' };

        mockCacheProvider.get.mockResolvedValue(null);
        mockCacheProvider.tryLock.mockResolvedValue(false);
        mockMethod.mockResolvedValue(expectedResult);

        const resultPromise = cacheOperations.getWithSwr(context, option);

        for (let i = 0; i < 15; i++) {
          await flushPromisesAndTimers(1000);
        }

        const result = await resultPromise;

        expect(result).toEqual(expectedResult);
        expect(mockMethod).toHaveBeenCalled();
        // 새 구현: tryLock은 1회만 호출, 이후 폴링 폴백(10회) → 최후 수단으로 method 직접 호출
        expect(mockCacheProvider.tryLock).toHaveBeenCalledTimes(1);
        expect(mockCacheProvider.put).not.toHaveBeenCalled();
      }, 30000); // 타임아웃 30초
    });

    describe('Cache Hit (Fresh/Stale)', () => {
      it('Fresh한 캐시가 있으면 즉시 반환해야 한다', async () => {
        const context = createContext();
        const option = createOption();
        const cachedData = { data: 'fresh' };
        const envelope = CacheEnvelope.create(cachedData, option.ttl!);

        mockCacheProvider.get.mockResolvedValue(envelope.toObject());

        const result = await cacheOperations.getWithSwr(context, option);

        expect(result).toEqual(cachedData);
        expect(mockMethod).not.toHaveBeenCalled();
        expect(mockCacheProvider.tryLock).not.toHaveBeenCalled();
      });

      it('Stale한 캐시가 있으면 데이터를 먼저 반환하고 백그라운드에서 갱신해야 한다', async () => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });

        const context = createContext();
        const option = createOption(1);
        const staleData = { data: 'stale' };
        const freshData = { data: 'fresh' };

        const staleEnvelope = new CacheEnvelope(staleData, Date.now() - 2000, Date.now() - 1000);

        mockCacheProvider.get.mockResolvedValue(staleEnvelope.toObject());
        mockCacheProvider.tryLock.mockResolvedValue(true);
        mockMethod.mockResolvedValue(freshData);

        const result = await cacheOperations.getWithSwr(context, option);
        expect(result).toEqual(staleData);
        expect(mockMethod).not.toHaveBeenCalled();

        // 백그라운드 작업 트리거
        await flushPromises();

        expect(mockMethod).toHaveBeenCalled();
        expect(mockCacheProvider.put).toHaveBeenCalled();
        expect(mockCacheProvider.unlock).toHaveBeenCalled();
      }, 15000);

      it('백그라운드 갱신 시 락을 획득하지 못하면 갱신을 포기해야 한다', async () => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });

        const context = createContext();
        const option = createOption();
        const staleEnvelope = new CacheEnvelope(
          { data: 'stale' },
          Date.now() - 2000,
          Date.now() - 1000,
        );

        mockCacheProvider.get.mockResolvedValue(staleEnvelope.toObject());
        mockCacheProvider.tryLock.mockResolvedValue(false);

        await cacheOperations.getWithSwr(context, option);

        await flushPromises();

        expect(mockCacheProvider.put).not.toHaveBeenCalled();
      }, 15000);
    });

    describe('Unless 조건', () => {
      it('unless 조건이 true이면 캐시를 저장하지 않아야 한다', async () => {
        const context = createContext();
        const option = createOption(60, (res) => res.error);
        const errorResult = { error: true, msg: 'fail' };

        mockCacheProvider.get.mockResolvedValue(null);
        mockCacheProvider.tryLock.mockResolvedValue(true);
        mockMethod.mockResolvedValue(errorResult);

        const result = await cacheOperations.getWithSwr(context, option);

        expect(result).toEqual(errorResult);
        expect(mockCacheProvider.put).not.toHaveBeenCalled();
        expect(mockCacheProvider.unlock).toHaveBeenCalled();
      });
    });
  });

  describe('bulkEvict', () => {
    it('allEntries가 true이면 패턴 삭제를 호출해야 한다', async () => {
      const context: CacheEvictContext = {
        keys: ['users:*'],
        cacheProvider: mockCacheProvider,
        allEntries: true,
      };
      await cacheOperations.bulkEvict(context);
      expect(mockCacheProvider.clearKeysByPattern).toHaveBeenCalledWith('users:*');
    });

    it('allEntries가 false이면 개별 삭제를 호출해야 한다', async () => {
      const context: CacheEvictContext = {
        keys: ['k1'],
        cacheProvider: mockCacheProvider,
        allEntries: false,
      };
      await cacheOperations.bulkEvict(context);
      expect(mockCacheProvider.evict).toHaveBeenCalledTimes(1);
    });
  });

  it('재시도 횟수에 따라 대기 시간이 지수적으로 증가해야 한다', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    const context = createContext();
    const option = createOption();

    const mockData = { data: 'ok' };
    const envelope = CacheEnvelope.create(mockData, option.ttl!);

    // tryLock 1회 실패 → pub/sub 없음 → 폴링 폴백
    // 폴링 0, 1회차는 null → 2회차에 캐시 발견
    mockCacheProvider.tryLock.mockResolvedValue(false);
    mockCacheProvider.get
      .mockResolvedValueOnce(null) // getWithSwr 초기 체크
      .mockResolvedValueOnce(null) // 폴링 attempt 0
      .mockResolvedValueOnce(null) // 폴링 attempt 1
      .mockResolvedValue(envelope.toObject()); // 폴링 attempt 2 → 캐시 발견

    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');

    const resultPromise = cacheOperations.getWithSwr(context, option);

    await flushPromisesAndTimers(); // 초기 get + tryLock + delay(0) 스케줄
    await flushPromisesAndTimers(); // delay(0) 실행 + get(null) + delay(1) 스케줄
    await flushPromisesAndTimers(); // delay(1) 실행 + get(null) + delay(2) 스케줄
    await flushPromisesAndTimers(); // delay(2) 실행 + get(envelope) → 캐시 발견

    await resultPromise;

    // 폴링 attempt 0, 1, 2 각각 delayWithExponentialBackoff → setTimeout 3회
    expect(setTimeoutSpy).toHaveBeenCalledTimes(3);
    const call1 = setTimeoutSpy.mock.calls[0][1] as number;
    expect(call1).toBeGreaterThanOrEqual(20); // baseDelayMs = 20
  });
  it('physicalTtl = ttl + staleTtl (기본 defaultStaleMultiplier: 5) 로 계산되어야 한다', async () => {
    const context = createContext();
    const option = createOption(30); // staleTtl = 30 * 5 = 150, physicalTtl = 30 + 150 = 180
    mockCacheProvider.get.mockResolvedValue(null);
    mockCacheProvider.tryLock.mockResolvedValue(true);
    mockMethod.mockResolvedValue({ data: 'ok' });
    await cacheOperations.getWithSwr(context, option);
    const putArgs = mockCacheProvider.put.mock.calls[0];
    const physicalTtl = putArgs[2];
    expect(physicalTtl).toBeGreaterThanOrEqual(150);
  });

  it('staleTtl을 명시하면 physicalTtl = ttl + staleTtl 로 계산되어야 한다', async () => {
    const context = createContext();
    const option: CacheableOption = { ttl: 60, staleTtl: 300 }; // physicalTtl = 60 + 300 = 360
    mockCacheProvider.get.mockResolvedValue(null);
    mockCacheProvider.tryLock.mockResolvedValue(true);
    mockMethod.mockResolvedValue({ data: 'ok' });
    await cacheOperations.getWithSwr(context, option);
    const putArgs = mockCacheProvider.put.mock.calls[0];
    const physicalTtl = putArgs[2];
    expect(physicalTtl).toBeGreaterThanOrEqual(360);
    expect(physicalTtl).toBeLessThan(400); // 지터 최대 20초
  });

  it('swr: false이면 SWR을 비활성화하고 단순 캐시 로직을 사용해야 한다', async () => {
    const context = createContext();
    const option: CacheableOption = { ttl: 60, swr: false };
    const expectedResult = { data: 'result' };

    mockCacheProvider.get.mockResolvedValue(null);
    mockMethod.mockResolvedValue(expectedResult);

    const result = await cacheOperations.getWithSwr(context, option);

    expect(result).toEqual(expectedResult);
    // SWR 비활성화 시 CacheEnvelope로 감싸지 않고 raw value를 저장
    expect(mockCacheProvider.put).toHaveBeenCalledWith('test-key', expectedResult, 60, undefined);
    // 분산 락 사용 안 함
    expect(mockCacheProvider.tryLock).not.toHaveBeenCalled();
  });

  it('동시에 여러 요청이 stale 캐시를 받아도 backgroundRefresh는 1회만 스케줄되어야 한다', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });

    const context = createContext();
    const option = createOption(1);
    const staleEnvelope = new CacheEnvelope(
      { data: 'stale' },
      Date.now() - 2000,
      Date.now() - 1000,
    );

    mockCacheProvider.get.mockResolvedValue(staleEnvelope.toObject());
    mockCacheProvider.tryLock.mockResolvedValue(false);

    // 동시에 3개 요청
    await Promise.all([
      cacheOperations.getWithSwr(context, option),
      cacheOperations.getWithSwr(context, option),
      cacheOperations.getWithSwr(context, option),
    ]);

    await flushPromises();

    // tryLock은 1회만 호출 (중복 스케줄 방지)
    expect(mockCacheProvider.tryLock).toHaveBeenCalledTimes(1);
  }, 15000);
});
