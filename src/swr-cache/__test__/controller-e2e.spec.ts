import { INestApplication, Module } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import supertest from 'supertest';

import { SwrCacheModule } from '../swr-cache.module';

import { TestController } from './fixture/test.controller';

describe('Controller E2E Tests', () => {
  let app: INestApplication;
  let moduleRef: TestingModule;
  let server: supertest.SuperTest<supertest.Test>;

  @Module({
    controllers: [TestController],
  })
  class TestModule {}

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        TestModule,
        SwrCacheModule.forRootAsync({
          useFactory: () => ({
            defaults: {
              ttl: 1000 * 60,
            },
            memory: {
              max: 100,
            },
          }),
        }),
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    await app.listen(0);

    server = supertest(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await server.post('/api/test/stats/reset').expect(201);
    await server.delete('/api/test/evict-multiple-namespaces').expect(200);
  });

  describe('@Cacheable', () => {
    describe('기본 캐싱 동작', () => {
      it('동일한 요청을 반복하면 두 번째부터는 캐시에서 반환되어야 한다', async () => {
        const res1 = await server.get('/api/test/explicit-key-basic/1').expect(200);
        expect(res1.body.executionCount).toBe(1);

        const res2 = await server.get('/api/test/explicit-key-basic/1').expect(200);
        expect(res2.body.executionCount).toBe(1); // 여전히 1
        expect(res2.body.timestamp).toBe(res1.body.timestamp);
      });

      it('다른 파라미터로 요청하면 별도의 캐시 항목으로 저장되어야 한다', async () => {
        const res1 = await server.get('/api/test/explicit-key-basic/2').expect(200);
        expect(res1.body.executionCount).toBe(1);

        const res2 = await server.get('/api/test/explicit-key-basic/3').expect(200);
        expect(res2.body.executionCount).toBe(1); // 다른 키이므로 새로 실행
      });
    });

    describe('다중 파라미터 캐싱', () => {
      it('모든 파라미터가 일치할 때만 캐시가 적용되어야 한다', async () => {
        const res1 = await server
          .get('/api/test/multi-param-key?category=electronics&page=1')
          .expect(200);
        expect(res1.body.executionCount).toBe(1);

        const res2 = await server
          .get('/api/test/multi-param-key?category=electronics&page=1')
          .expect(200);
        expect(res2.body.executionCount).toBe(1);

        const res3 = await server
          .get('/api/test/multi-param-key?category=books&page=1')
          .expect(200);
        expect(res3.body.executionCount).toBe(1); // 다른 키이므로 새로 실행
      });
    });

    describe('조건부 캐싱', () => {
      it('unless 조건에 해당하면 결과를 캐시하지 않아야 한다 (error가 있는 경우)', async () => {
        const res1 = await server.get('/api/test/conditional-cache/-1').expect(200);
        expect(res1.body.error).toBeDefined();
        expect(res1.body.executionCount).toBe(1);

        const res2 = await server.get('/api/test/conditional-cache/-1').expect(200);
        expect(res2.body.executionCount).toBe(2); // 캐시되지 않아 재실행
      });

      it('condition 조건을 만족할 때만 캐싱되어야 한다 (id > 0)', async () => {
        // id > 0 인 경우: 캐싱됨
        const res1 = await server.get('/api/test/conditional-cache/5').expect(200);
        expect(res1.body.executionCount).toBe(1);

        const res2 = await server.get('/api/test/conditional-cache/5').expect(200);
        expect(res2.body.executionCount).toBe(1); // 캐시됨

        // id <= 0 인 경우: 캐싱 안됨
        const res3 = await server.get('/api/test/conditional-cache/0').expect(200);
        expect(res3.body.executionCount).toBe(1);

        const res4 = await server.get('/api/test/conditional-cache/0').expect(200);
        expect(res4.body.executionCount).toBe(2); // 캐시 안됨
      });
    });

    describe('자동 키 해싱', () => {
      it('키를 명시하지 않으면 파라미터를 해시하여 자동으로 캐시 키를 생성해야 한다', async () => {
        const id = 'abc';
        const q = 'search';
        const body = { user: 'test' };

        // 첫 요청: 실행 및 캐시
        const res1 = await server
          .post(`/api/test/auto-hashed-cache/${id}?q=${q}`)
          .send(body)
          .expect(201);
        expect(res1.body.executionCount).toBe(1);

        // 동일한 파라미터: 캐시에서 반환
        const res2 = await server
          .post(`/api/test/auto-hashed-cache/${id}?q=${q}`)
          .send(body)
          .expect(201);
        expect(res2.body.executionCount).toBe(1); // 캐시됨

        // Query 파라미터 변경: 새로운 캐시 생성
        const res3 = await server
          .post(`/api/test/auto-hashed-cache/${id}?q=search2`)
          .send(body)
          .expect(201);
        expect(res3.body.executionCount).toBe(1);

        // Body 변경: 새로운 캐시 생성
        const res4 = await server
          .post(`/api/test/auto-hashed-cache/${id}?q=${q}`)
          .send({ user: 'test2' })
          .expect(201);
        expect(res4.body.executionCount).toBe(1);

        // Path 파라미터 변경: 새로운 캐시 생성
        const res5 = await server
          .post(`/api/test/auto-hashed-cache/def?q=${q}`)
          .send(body)
          .expect(201);
        expect(res5.body.executionCount).toBe(1);

        // 실행 통계 확인
        const stats = await server.get('/api/test/stats/execution-count').expect(200);
        expect(stats.body['getCacheableWithAutoHash-abc-search-{"user":"test"}']).toBe(1);
        expect(stats.body['getCacheableWithAutoHash-abc-search2-{"user":"test"}']).toBe(1);
        expect(stats.body['getCacheableWithAutoHash-abc-search-{"user":"test2"}']).toBe(1);
        expect(stats.body['getCacheableWithAutoHash-def-search-{"user":"test"}']).toBe(1);
      });
    });
  });

  describe('@CacheEvict', () => {
    describe('명시적 키를 사용한 캐시 삭제', () => {
      it('지정된 키에 해당하는 캐시 항목만 삭제되어야 한다', async () => {
        // 캐시 생성
        const res1 = await server.get('/api/test/explicit-key-basic/10').expect(200);
        expect(res1.body.executionCount).toBe(1);

        // 캐시 확인
        const res2 = await server.get('/api/test/explicit-key-basic/10').expect(200);
        expect(res2.body.executionCount).toBe(1);

        // 캐시 삭제
        await server.post('/api/test/evict-explicit-key/10').send({ name: 'Updated' }).expect(201);

        // 캐시가 삭제되어 재실행됨
        const res3 = await server.get('/api/test/explicit-key-basic/10').expect(200);
        expect(res3.body.executionCount).toBe(2); // 다시 실행됨
      });

      it('동일한 키 전략을 공유하면 다른 메서드에서도 캐시 삭제가 가능하다', async () => {
        // 캐시 생성
        const res1 = await server.get('/api/test/shared-key-cache/test').expect(200);
        expect(res1.body.executionCount).toBe(1);

        // 캐시 확인
        const res2 = await server.get('/api/test/shared-key-cache/test').expect(200);
        expect(res2.body.executionCount).toBe(1);

        // 다른 메서드에서 동일한 키로 삭제
        await server.post('/api/test/shared-key-evict/test').send({ data: 'update' }).expect(201);

        // 캐시가 삭제되어 재실행됨
        const res3 = await server.get('/api/test/shared-key-cache/test').expect(200);
        expect(res3.body.executionCount).toBe(2);
      });
    });

    describe('조건부 캐시 삭제', () => {
      it('beforeInvocation=true면 메서드 실행 전에 캐시를 삭제해야 한다', async () => {
        // 캐시 생성
        await server.get('/api/test/multi-param-key?category=test').expect(200);
        const res1 = await server.get('/api/test/multi-param-key?category=test').expect(200);
        expect(res1.body.executionCount).toBe(1);

        // 에러가 발생해도 beforeInvocation이 true면 캐시가 삭제됨
        await server.delete('/api/test/conditional-evict-all/all').expect(500);

        // 캐시가 삭제되어 재실행됨
        const res2 = await server.get('/api/test/multi-param-key?category=test').expect(200);
        expect(res2.body.executionCount).toBe(2);
      });

      it('condition 조건을 만족할 때만 캐시가 삭제되어야 한다', async () => {
        // 캐시 생성
        await server.get('/api/test/multi-param-key?category=test2').expect(200);
        const res1 = await server.get('/api/test/multi-param-key?category=test2').expect(200);
        expect(res1.body.executionCount).toBe(1);

        // condition 불만족 (id !== 'all')
        await server.delete('/api/test/conditional-evict-all/not-all').expect(500);

        // 캐시가 삭제되지 않음
        const res2 = await server.get('/api/test/multi-param-key?category=test2').expect(200);
        expect(res2.body.executionCount).toBe(1);
      });
    });

    it('자동 해싱 사용 시 메서드 시그니처가 달라 캐시가 삭제되지 않는다 (의도된 동작)', async () => {
      const id = 'problem-1';
      const q = 'search';
      const body = { data: 'test' };

      // 캐시 생성 (getCacheableWithAutoHash 메서드)
      const res1 = await server
        .post(`/api/test/auto-hashed-cache/${id}?q=${q}`)
        .send(body)
        .expect(201);
      expect(res1.body.executionCount).toBe(1);

      // 캐시 확인
      const res2 = await server
        .post(`/api/test/auto-hashed-cache/${id}?q=${q}`)
        .send(body)
        .expect(201);
      expect(res2.body.executionCount).toBe(1);

      // 삭제 시도
      await server.delete(`/api/test/auto-hashed-evict/${id}?q=${q}`).send(body).expect(200);

      // 캐시가 삭제되지 않음 (메서드 시그니처가 키에 포함되어 다른 키가 생성됨)
      const res3 = await server
        .post(`/api/test/auto-hashed-cache/${id}?q=${q}`)
        .send(body)
        .expect(201);
      expect(res3.body.executionCount).toBe(1); // 여전히 캐시됨!
    });

    it('여러 네임스페이스를 한 번에 삭제할 수 있어야 한다', async () => {
      // 각 네임스페이스에 캐시 생성
      await server.get('/api/test/explicit-key-basic/multi-1').expect(200);
      await server.get('/api/test/multi-param-key?category=multi').expect(200);
      await server.get('/api/test/conditional-cache/100').expect(200);
      await server.get('/api/test/shared-key-cache/multi-2').expect(200);

      // 캐시 확인
      const res1 = await server.get('/api/test/explicit-key-basic/multi-1').expect(200);
      const res2 = await server.get('/api/test/multi-param-key?category=multi').expect(200);
      const res3 = await server.get('/api/test/conditional-cache/100').expect(200);
      const res4 = await server.get('/api/test/shared-key-cache/multi-2').expect(200);

      expect(res1.body.executionCount).toBe(1);
      expect(res2.body.executionCount).toBe(1);
      expect(res3.body.executionCount).toBe(1);
      expect(res4.body.executionCount).toBe(1);

      // 모든 네임스페이스 삭제
      await server.delete('/api/test/evict-multiple-namespaces').expect(200);

      // 모든 캐시가 삭제되어 재실행됨
      const res5 = await server.get('/api/test/explicit-key-basic/multi-1').expect(200);
      const res6 = await server.get('/api/test/multi-param-key?category=multi').expect(200);
      const res7 = await server.get('/api/test/conditional-cache/100').expect(200);
      const res8 = await server.get('/api/test/shared-key-cache/multi-2').expect(200);

      expect(res5.body.executionCount).toBe(2);
      expect(res6.body.executionCount).toBe(2);
      expect(res7.body.executionCount).toBe(2);
      expect(res8.body.executionCount).toBe(2);
    });
  });

  describe('두 개 이상의 데코레이터를 사용하는 경우', () => {
    describe('@Cacheable + @CacheEvict 동시 사용', () => {
      it('캐싱과 동시에 다른 네임스페이스의 캐시를 삭제해야 한다', async () => {
        // products 네임스페이스에 캐시 생성
        await server.get('/api/test/multi-param-key?category=electronics').expect(200);
        const res1 = await server.get('/api/test/multi-param-key?category=electronics').expect(200);
        expect(res1.body.executionCount).toBe(1);

        // dual-decorator 호출: 자신은 캐싱하고 products는 삭제
        const res2 = await server.get('/api/test/dual-decorator/1').expect(200);
        expect(res2.body.executionCount).toBe(1);

        // products 캐시가 삭제되었는지 확인
        const res3 = await server.get('/api/test/multi-param-key?category=electronics').expect(200);
        expect(res3.body.executionCount).toBe(2); // 재실행됨

        // dual-decorator 자체는 캐싱되었는지 확인
        const res4 = await server.get('/api/test/dual-decorator/1').expect(200);
        expect(res4.body.executionCount).toBe(1); // 캐시됨
        expect(res4.body.timestamp).toBe(res2.body.timestamp);
      });

      it('각 ID별로 독립적인 캐시가 생성되고 products는 전체 삭제되어야 한다', async () => {
        // products 네임스페이스에 여러 캐시 생성
        await server.get('/api/test/multi-param-key?category=books').expect(200);
        await server.get('/api/test/multi-param-key?category=toys').expect(200);

        // 캐시 확인
        const res1 = await server.get('/api/test/multi-param-key?category=books').expect(200);
        const res2 = await server.get('/api/test/multi-param-key?category=toys').expect(200);
        expect(res1.body.executionCount).toBe(1);
        expect(res2.body.executionCount).toBe(1);

        // dual-decorator 호출
        await server.get('/api/test/dual-decorator/2').expect(200);

        // 모든 products 캐시가 삭제되었는지 확인
        const res3 = await server.get('/api/test/multi-param-key?category=books').expect(200);
        const res4 = await server.get('/api/test/multi-param-key?category=toys').expect(200);
        expect(res3.body.executionCount).toBe(2); // 재실행됨
        expect(res4.body.executionCount).toBe(2); // 재실행됨
      });
    });

    describe('여러 @CacheEvict 데코레이터 사용', () => {
      it('여러 네임스페이스를 동시에 삭제할 수 있어야한다', async () => {
        // users와 products 네임스페이스에 캐시 생성
        await server.get('/api/test/explicit-key-basic/20').expect(200);
        await server.get('/api/test/multi-param-key?category=test-multi').expect(200);

        // 캐시 확인
        const res1 = await server.get('/api/test/explicit-key-basic/20').expect(200);
        const res2 = await server.get('/api/test/multi-param-key?category=test-multi').expect(200);
        expect(res1.body.executionCount).toBe(1);
        expect(res2.body.executionCount).toBe(1);

        // cacheEvict 여러개 호출 (users와 products 삭제)
        const res3 = await server.delete('/api/test/multi-evict').expect(200);
        expect(res3.body.cleared).toEqual(['users', 'products']);
        expect(res3.body.executionCount).toBe(1);

        // 두 네임스페이스 모두 삭제되었는지 확인
        const res4 = await server.get('/api/test/explicit-key-basic/20').expect(200);
        const res5 = await server.get('/api/test/multi-param-key?category=test-multi').expect(200);
        expect(res4.body.executionCount).toBe(2); // 재실행됨
        expect(res5.body.executionCount).toBe(2); // 재실행됨
      });

      it('각 @CacheEvict이 독립적으로 실행되어야 한다', async () => {
        // 여러 캐시 생성
        await server.get('/api/test/explicit-key-basic/30').expect(200);
        await server.get('/api/test/explicit-key-basic/31').expect(200);
        await server.get('/api/test/multi-param-key?category=cat1').expect(200);
        await server.get('/api/test/multi-param-key?category=cat2').expect(200);

        // cacheEvict 여러개 호출
        await server.delete('/api/test/multi-evict').expect(200);

        // 모든 캐시가 삭제되었는지 확인
        const res1 = await server.get('/api/test/explicit-key-basic/30').expect(200);
        const res2 = await server.get('/api/test/explicit-key-basic/31').expect(200);
        const res3 = await server.get('/api/test/multi-param-key?category=cat1').expect(200);
        const res4 = await server.get('/api/test/multi-param-key?category=cat2').expect(200);

        expect(res1.body.executionCount).toBe(2);
        expect(res2.body.executionCount).toBe(2);
        expect(res3.body.executionCount).toBe(2);
        expect(res4.body.executionCount).toBe(2);
      });
    });

    describe('조건부 @Cacheable + 조건부 @CacheEvict', () => {
      it('각 데코레이터의 condition이 독립적으로 평가되어야 한다', async () => {
        // shared-key-namespace에 캐시 생성
        await server.get('/api/test/shared-key-cache/2').expect(200);
        const res1 = await server.get('/api/test/shared-key-cache/2').expect(200);
        expect(res1.body.executionCount).toBe(1);

        // 캐싱 조건(id>0)과 삭제 조건(id%2==0) 모두 만족
        const res2 = await server
          .post('/api/test/conditional-dual/2')
          .send({ data: 'test' })
          .expect(201);
        expect(res2.body.executionCount).toBe(1);

        // shared-key-2가 삭제되었는지 확인
        const res3 = await server.get('/api/test/shared-key-cache/2').expect(200);
        expect(res3.body.executionCount).toBe(2); // 재실행됨

        // conditional-dual/2 엔드포인트가 캐싱되었는지 확인
        const res4 = await server
          .post('/api/test/conditional-dual/2')
          .send({ data: 'test' })
          .expect(201);
        expect(res4.body.executionCount).toBe(1); // 캐시되면 1번만 호출
        expect(res4.body.timestamp).toBe(res2.body.timestamp);
      });

      it('캐싱 조건 불만족 시 캐싱되지 않아야 한다', async () => {
        // 캐싱 조건 불만족(id<=0) + 삭제 조건 만족(id%2==0)
        const res1 = await server
          .post('/api/test/conditional-dual/0')
          .send({ data: 'test' })
          .expect(201);
        expect(res1.body.executionCount).toBe(1);

        // 캐싱되지 않았는지 확인
        const res2 = await server
          .post('/api/test/conditional-dual/0')
          .send({ data: 'test' })
          .expect(201);
        expect(res2.body.executionCount).toBe(2); // 재실행됨
      });

      it('삭제 조건 불만족 시 캐시가 삭제되지 않아야 한다', async () => {
        // shared-key-namespace에 캐시 생성
        await server.get('/api/test/shared-key-cache/3').expect(200);
        const res1 = await server.get('/api/test/shared-key-cache/3').expect(200);
        expect(res1.body.executionCount).toBe(1);

        // 캐싱 조건 만족(id>0), 삭제 조건 불만족(id%2!=0)
        const res2 = await server
          .post('/api/test/conditional-dual/3')
          .send({ data: 'test' })
          .expect(201);
        expect(res2.body.executionCount).toBe(1);

        // shared-key-3가 삭제되지 않았는지 확인
        const res3 = await server.get('/api/test/shared-key-cache/3').expect(200);
        expect(res3.body.executionCount).toBe(1); // 여전히 캐시됨

        // conditional-dual/3는 엔드포인트가 캐싱되었는지 확인
        const res4 = await server
          .post('/api/test/conditional-dual/3')
          .send({ data: 'test' })
          .expect(201);
        expect(res4.body.executionCount).toBe(1); // 캐시됨
      });
    });

    describe('데코레이터 실행 순서', () => {
      it('데코레이터 선언 순서에 맞게 실행되어야 한다', async () => {
        // products에 캐시 생성
        await server.get('/api/test/multi-param-key?category=order-test').expect(200);
        const res1 = await server.get('/api/test/multi-param-key?category=order-test').expect(200);
        expect(res1.body.executionCount).toBe(1);

        // 첫 호출: 메서드 실행 후 캐싱, 그 다음 products 삭제
        const res2 = await server.get('/api/test/dual-decorator/order-1').expect(200);
        expect(res2.body.executionCount).toBe(1);

        // products가 삭제되었는지 확인
        const res3 = await server.get('/api/test/multi-param-key?category=order-test').expect(200);
        expect(res3.body.executionCount).toBe(2);

        // 두 번째 호출: 캐시에서 반환 (CacheEvict은 실행되지 않음)
        const res4 = await server.get('/api/test/dual-decorator/order-1').expect(200);
        expect(res4.body.executionCount).toBe(1); // 캐시됨

        // products에 다시 캐시 생성
        await server.get('/api/test/multi-param-key?category=order-test2').expect(200);
        const res5 = await server.get('/api/test/multi-param-key?category=order-test2').expect(200);
        expect(res5.body.executionCount).toBe(1);

        // 캐시된 dual-decorator를 다시 호출해도 products는 삭제되지 않음
        await server.get('/api/test/dual-decorator/order-1').expect(200);
        const res6 = await server.get('/api/test/multi-param-key?category=order-test2').expect(200);
        expect(res6.body.executionCount).toBe(1); // 여전히 캐시됨 (CacheEvict 실행 안됨)
      });
    });
  });

  describe('Stale-While-Revalidate', () => {
    it('동시에 요청이 여러 개 들어와도 원본 메서드는 한 번만 실행되어야 한다', async () => {
      // 동시에 100개의 요청 발생
      const promises = Array(100)
        .fill(null)
        .map(() => server.get('/api/test/explicit-key-basic/200'));

      const responses = await Promise.all(promises);

      const firstTimestamp = responses[0].body.timestamp;
      for (const response of responses) {
        expect(response.status).toBe(200);
        expect(response.body.executionCount).toBe(1);
        expect(response.body.timestamp).toBe(firstTimestamp); // 모두 동일한 타임스탬프
      }

      const stats = await server.get('/api/test/stats/execution-count').expect(200);
      expect(stats.body['getCacheableWithExplicitKey-200']).toBe(1); // 실제 실행은 한 번
    });

    it('TTL이 지난 stale 데이터가 발견되면 즉시 반환하고 백그라운드에서 캐시를 갱신해야 한다', async () => {
      // 초기 캐시 생성
      const res1 = await server.get('/api/test/swr-test/1').expect(200);
      expect(res1.body.executionCount).toBe(1);
      const initialTimestamp = res1.body.timestamp;
      const initialGeneratedAt = res1.body.generatedAt;

      // TTL 내에서 캐시 확인 (TTL = 1초)
      const res2 = await server.get('/api/test/swr-test/1').expect(200);
      expect(res2.body.executionCount).toBe(1);
      expect(res2.body.timestamp).toBe(initialTimestamp);

      // TTL이 지날 때까지 대기 (1.5초)
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Stale 데이터 즉시 반환 확인
      const startTime = Date.now();
      const res3 = await server.get('/api/test/swr-test/1').expect(200);
      const responseTime = Date.now() - startTime;

      // Stale 데이터가 즉시 반환되어야 함 (150ms 미만)
      expect(responseTime).toBeLessThan(150);
      expect(res3.body.executionCount).toBe(1); // 아직 이전 캐시 데이터
      expect(res3.body.timestamp).toBe(initialTimestamp);
      expect(res3.body.generatedAt).toBe(initialGeneratedAt);

      // 백그라운드 갱신 완료 대기 (메서드 실행 시간 100ms + 50ms 추가 대기)
      await new Promise((resolve) => setTimeout(resolve, 150));

      // 갱신된 새로운 데이터 확인
      const res4 = await server.get('/api/test/swr-test/1').expect(200);
      expect(res4.body.executionCount).toBe(2); // 백그라운드에서 갱신된 값
      expect(res4.body.timestamp).toBeGreaterThan(initialTimestamp);
      expect(res4.body.generatedAt).not.toBe(initialGeneratedAt);
    });

    it('여러 요청이 동시 요청하는 상황에서 stale 데이터를 발견해도 백그라운드 갱신은 한 번만 일어나야 한다', async () => {
      // 초기 캐시 생성
      const res1 = await server.get('/api/test/swr-test/2').expect(200);
      expect(res1.body.executionCount).toBe(1);
      const initialTimestamp = res1.body.timestamp;

      // TTL이 지날 때까지 대기
      await new Promise((resolve) => setTimeout(resolve, 1200));

      // 동시에 여러 요청 발송 (모두 stale 데이터 받음)
      const promises = Array(3)
        .fill(null)
        .map(() => server.get('/api/test/swr-test/2'));

      const responses = await Promise.all(promises);

      // 모든 요청이 즉시 stale 데이터를 받아야 함
      responses.forEach((response) => {
        expect(response.status).toBe(200);
        expect(response.body.executionCount).toBe(1); // stale 데이터
        expect(response.body.timestamp).toBe(initialTimestamp);
      });

      // 백그라운드 갱신 완료 대기
      await new Promise((resolve) => setTimeout(resolve, 300));

      // 갱신된 데이터 확인
      const res5 = await server.get('/api/test/swr-test/2').expect(200);
      expect(res5.body.executionCount).toBe(2); // 한 번만 갱신됨
      expect(res5.body.timestamp).toBeGreaterThan(initialTimestamp);

      // 통계 확인 - 실제로 메서드가 2번만 실행되었는지
      const stats = await server.get('/api/test/stats/execution-count').expect(200);
      expect(stats.body['getSwrTestData-2']).toBe(2); // 초기 1번 + 백그라운드 갱신 1번
    });

    it('stale 상태가 아닌 경우 백그라운드 갱신이 일어나지 않아야 한다', async () => {
      // 캐시 생성
      const res1 = await server.get('/api/test/swr-counter').expect(200);
      expect(res1.body.counter).toBe(1);

      // TTL 내에서 여러 번 요청 (TTL = 2초)
      await new Promise((resolve) => setTimeout(resolve, 500));
      const res2 = await server.get('/api/test/swr-counter').expect(200);
      expect(res2.body.counter).toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 500));
      const res3 = await server.get('/api/test/swr-counter').expect(200);
      expect(res3.body.counter).toBe(1);

      // 백그라운드 갱신이 일어나지 않았는지 확인
      await new Promise((resolve) => setTimeout(resolve, 200));
      const stats = await server.get('/api/test/stats/execution-count').expect(200);
      expect(stats.body['getSwrCounter']).toBe(1); // 초기 실행 1번만
    });

    it('stale 데이터 반환 후 에러가 발생해도 이전 캐시가 유지되어야 한다', async () => {
      // 초기 캐시 생성 - 첫 번째 실행은 성공
      const res1 = await server.get('/api/test/swr-error/error-test').expect(200);
      expect(res1.body.executionCount).toBe(1);
      expect(res1.body.status).toBe('success');
      const initialTimestamp = res1.body.timestamp;
      const initialValue = res1.body.value;

      // TTL이 지날 때까지 대기 (1.2초)
      await new Promise((resolve) => setTimeout(resolve, 1200));

      // Stale 데이터 즉시 반환 (백그라운드에서 갱신 시도 - 에러 발생)
      const res2 = await server.get('/api/test/swr-error/error-test').expect(200);
      expect(res2.body.executionCount).toBe(1); // stale 데이터 반환
      expect(res2.body.timestamp).toBe(initialTimestamp);
      expect(res2.body.value).toBe(initialValue);

      // 백그라운드 갱신 시도 완료 대기 (에러가 발생했음)
      await new Promise((resolve) => setTimeout(resolve, 300));

      // 에러가 발생했지만 stale 캐시가 여전히 유지되는지 확인
      const res3 = await server.get('/api/test/swr-error/error-test').expect(200);
      expect(res3.body.executionCount).toBe(1); // 여전히 기존 캐시 유지
      expect(res3.body.timestamp).toBe(initialTimestamp);
      expect(res3.body.value).toBe(initialValue);
      expect(res3.body.status).toBe('success'); // 기존 성공 데이터가 유지됨

      // 실행 통계 확인 - 백그라운드에서 갱신이 시도되었지만 실패했음
      const stats = await server.get('/api/test/stats/execution-count').expect(200);
      expect(stats.body['getSwrErrorTestData-error-test']).toBe(3); // 초기 1번 + 백그라운드 실패 2번
    });

    it('물리적 TTL은 논리적 TTL보다 길게 저장되어있어야 한다', async () => {
      // 초기 캐시 생성 (TTL = 1초)
      const res1 = await server.get('/api/test/swr-test/ttl-test').expect(200);
      expect(res1.body.executionCount).toBe(1);

      // 논리적 TTL(1초) 경과 후
      await new Promise((resolve) => setTimeout(resolve, 1200));

      // Stale이지만 물리적으로는 여전히 캐시에 존재
      const res2 = await server.get('/api/test/swr-test/ttl-test').expect(200);
      expect(res2.body.executionCount).toBe(1); // stale 데이터

      // 백그라운드 갱신 완료 대기
      await new Promise((resolve) => setTimeout(resolve, 300));

      // 갱신된 데이터 확인
      const res3 = await server.get('/api/test/swr-test/ttl-test').expect(200);
      expect(res3.body.executionCount).toBe(2);

      // 물리적 TTL은 논리적 TTL보다 훨씬 김 (multiplier 적용)
      // TTL 1초 → 물리적 TTL은 10배 (10초)
    });

    it('캐시 미스 시에도 동시 요청에 대해 한 번만 실행되어야 한다', async () => {
      // 캐시가 없는 상태에서 동시 요청 (수를 줄여서 테스트)
      const promises = Array(5)
        .fill(null)
        .map(() => server.get('/api/test/swr-test/stampede-test'));

      const responses = await Promise.all(promises);

      // 모든 요청이 같은 결과를 받아야 함
      const firstTimestamp = responses[0].body.timestamp;
      for (let i = 0; i < responses.length; i++) {
        const response = responses[i];

        expect(response.status).toBe(200);
        expect(response.body.executionCount).toBe(1);
        expect(response.body.timestamp).toBe(firstTimestamp);
      }

      // 실제로 한 번만 실행되었는지 확인
      const stats = await server.get('/api/test/stats/execution-count').expect(200);
      expect(stats.body['getSwrTestData-stampede-test']).toBe(1);
    });

    it('stale 상태에서 동시 요청 시 백그라운드 갱신도 한 번만 일어나야 한다', async () => {
      // 캐시 생성
      await server.get('/api/test/swr-test/concurrent-stale').expect(200);

      // TTL 경과
      await new Promise((resolve) => setTimeout(resolve, 1200));

      // 동시에 stale 요청
      const promises = Array(20)
        .fill(null)
        .map(() => server.get('/api/test/swr-test/concurrent-stale'));

      await Promise.all(promises);

      // 백그라운드 갱신 완료 대기
      await new Promise((resolve) => setTimeout(resolve, 300));

      // 갱신은 한 번만 일어났는지 확인
      const stats = await server.get('/api/test/stats/execution-count').expect(200);
      expect(stats.body['getSwrTestData-concurrent-stale']).toBe(2); // 초기 1 + 갱신 1
    });
  });

  describe('Compression', () => {
    describe('대용량 데이터 압축', () => {
      it('20KB 이상의 대용량 데이터는 압축되어 캐싱되어야 한다', async () => {
        // 첫 번째 요청: 캐시 생성
        const res1 = await server.get('/api/test/large-data/compress-1').expect(200);
        expect(res1.body.executionCount).toBe(1);
        expect(res1.body.items).toHaveLength(500);

        // 두 번째 요청: 캐시에서 반환 (압축 해제됨)
        const res2 = await server.get('/api/test/large-data/compress-1').expect(200);
        expect(res2.body.executionCount).toBe(1); // 캐시에서 반환
        expect(res2.body.items).toHaveLength(500);

        // 데이터 무결성 확인
        expect(res2.body.id).toBe('compress-1');
        expect(res2.body.items[0].id).toBe('item-0');
        expect(res2.body.items[499].id).toBe('item-499');
      });

      it('압축된 캐시 데이터가 올바르게 복원되어야 한다', async () => {
        const res1 = await server.get('/api/test/large-data/compress-2').expect(200);
        const res2 = await server.get('/api/test/large-data/compress-2').expect(200);

        // 원본과 캐시된 데이터가 동일해야 함
        expect(res2.body.id).toBe(res1.body.id);
        expect(res2.body.items.length).toBe(res1.body.items.length);
        expect(res2.body.timestamp).toBe(res1.body.timestamp);

        // 중첩된 객체도 올바르게 복원되어야 함
        expect(res2.body.items[0].metadata.tags).toEqual(['tag1', 'tag2', 'tag3']);
        expect(res2.body.items[0].metadata.category).toBe('electronics');
      });
    });

    describe('소용량 데이터 비압축', () => {
      it('20KB 미만의 소용량 데이터는 압축 없이 캐싱되어야 한다', async () => {
        const res1 = await server.get('/api/test/small-data/small-1').expect(200);
        expect(res1.body.executionCount).toBe(1);

        const res2 = await server.get('/api/test/small-data/small-1').expect(200);
        expect(res2.body.executionCount).toBe(1); // 캐시에서 반환

        // 데이터 무결성 확인
        expect(res2.body.id).toBe('small-1');
        expect(res2.body.name).toBe('Small Data small-1');
      });
    });

    describe('압축 데이터 무결성', () => {
      it('유니코드 문자열이 포함된 대용량 데이터도 올바르게 처리되어야 한다', async () => {
        // 유니코드 데이터는 large-data 엔드포인트의 description에 포함될 수 있음
        const res1 = await server.get('/api/test/large-data/unicode-test').expect(200);
        const res2 = await server.get('/api/test/large-data/unicode-test').expect(200);

        expect(res2.body.executionCount).toBe(1); // 캐시에서 반환
        expect(res2.body.items).toHaveLength(500);
      });

      it('동시에 여러 요청이 대용량 데이터를 조회해도 일관된 결과를 반환해야 한다', async () => {
        const promises = Array(10)
          .fill(null)
          .map(() => server.get('/api/test/large-data/concurrent-compress'));

        const responses = await Promise.all(promises);

        const firstTimestamp = responses[0].body.timestamp;
        for (const response of responses) {
          expect(response.status).toBe(200);
          expect(response.body.executionCount).toBe(1);
          expect(response.body.timestamp).toBe(firstTimestamp);
          expect(response.body.items).toHaveLength(500);
        }
      });
    });
  });
});
