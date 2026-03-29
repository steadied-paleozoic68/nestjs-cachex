# nestjs-cachex

NestJS를 위한 프로덕션 수준의 데코레이터 기반 캐싱 모듈입니다.

SWR(Stale-While-Revalidate), Single-flight, 자동 압축, 멀티레벨 캐시를 하나의 패키지로 제공합니다.

---

## 소개

`nestjs-cachex`는 NestJS 서버에서 캐싱을 선언적으로 적용하기 위해 만들어졌습니다.

기존 캐싱 모듈은 캐시 저장/조회는 지원하지만, **캐시 만료 순간의 지연**을 해결하지 못합니다. 캐시가 만료되면 다음 요청이 직접 DB나 외부 API를 호출해야 하고, 동시에 여러 요청이 몰리면 Thundering Herd 문제가 발생합니다.

`nestjs-cachex`는 이 문제를 세 가지 방식으로 해결합니다.

- **SWR 패턴** — TTL이 만료된 순간에도 이전 데이터를 즉시 반환하고, 백그라운드에서 갱신합니다. 사용자는 지연을 느끼지 않습니다.
- **Single-flight** — 동일한 키에 대해 한 번에 하나의 갱신만 실행됩니다. Redis 분산 락과 Pub/Sub으로 여러 서버 인스턴스 간에도 중복 실행을 방지합니다.
- **멀티레벨 캐시** — L1(In-Memory)과 L2(Redis)를 계층으로 구성해 네트워크 비용 없이 최대한 빠른 응답을 제공합니다.

---

## 빠른 시작

```typescript
import { Cacheable, CacheEvict } from 'nestjs-cachex';

@Injectable()
export class UserService {
  @Cacheable({ ttl: 60, name: 'users', key: (id: string) => id })
  async findUser(id: string) {
    return this.userRepository.findOne(id); // 결과가 자동으로 캐싱됩니다
  }

  @CacheEvict({ name: 'users', key: (id: string) => id })
  async updateUser(id: string, data: UpdateUserDto) {
    return this.userRepository.update(id, data); // 실행 후 해당 캐시를 삭제합니다
  }
}
```

데코레이터 하나로 캐싱 로직을 비즈니스 코드에서 완전히 분리할 수 있습니다.

---

## 주요 기능

- **데코레이터 기반** — `@Cacheable`, `@CacheEvict`로 메서드 단위 캐싱 적용
- **SWR 패턴** — stale 데이터를 즉시 반환하고 백그라운드에서 갱신. 응답 지연 제로
- **Single-flight** — 분산 락 + Pub/Sub으로 멀티 인스턴스 환경에서도 중복 갱신 방지
- **자동 압축** — Brotli 기반 자동 압축/해제. 설정한 임계값 이하는 압축 생략
- **멀티레벨 캐시** — L1(메모리) + L2(Redis) 계층 구성. L1 미스 시 L2 조회 후 Write-back
- **유연한 키 생성** — 문자열 고정값 또는 함수로 동적 키 생성
- **조건부 캐싱** — `condition`(저장 전), `unless`(저장 후)로 세밀한 제어
- **TypeScript** — 완전한 타입 지원

---

## 설치

```bash
npm install nestjs-cachex
# 또는
yarn add nestjs-cachex
```

Redis를 사용한다면 ioredis를 함께 설치합니다.

```bash
npm install ioredis
```

---

## 사용법

### 모듈 등록

#### 정적 등록

```typescript
import { SwrCacheModule, CacheManager } from 'nestjs-cachex';

@Module({
  imports: [
    SwrCacheModule.forRoot({
      defaults: {
        ttl: 300,
        cacheManager: CacheManager.REDIS,
      },
    }),
  ],
})
export class AppModule {}
```

#### 동적 등록 (ConfigModule 등과 함께 사용)

```typescript
SwrCacheModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  redisToken: REDIS_CLIENT,          // 일반 커넥션
  subscriberToken: REDIS_SUBSCRIBER, // Pub/Sub 전용 커넥션 (별도 필요)
  useFactory: async (config: ConfigService) => ({
    defaults: {
      ttl: config.get('CACHE_TTL'),
      cacheManager: CacheManager.REDIS,
    },
    swr: {
      enabled: true,
      defaultStaleMultiplier: 5, // staleTtl 미설정 시 ttl × 5
      pubSubTimeoutMs: 2000,     // Pub/Sub 대기 타임아웃
    },
    compression: {
      enabled: true,
      threshold: 20 * 1024, // 20KB 이상만 압축
      level: 3,
    },
  }),
})
```

#### Redis 클라이언트 구성

Pub/Sub에는 전용 커넥션이 필요합니다. 일반 커넥션과 **반드시 분리**해서 주입하세요.

```typescript
export const REDIS_CLIENT = 'REDIS_CLIENT';
export const REDIS_SUBSCRIBER = 'REDIS_SUBSCRIBER';

@Module({
  providers: [
    { provide: REDIS_CLIENT, useFactory: () => new Redis({ host: 'localhost', port: 6379 }) },
    { provide: REDIS_SUBSCRIBER, useFactory: () => new Redis({ host: 'localhost', port: 6379 }) },
  ],
  exports: [REDIS_CLIENT, REDIS_SUBSCRIBER],
})
export class RedisModule {}
```

### @Cacheable

```typescript
// SWR 패턴
@Cacheable({
  ttl: 10,       // 10초 동안 fresh
  staleTtl: 290, // 이후 290초 동안 stale 제공 + 백그라운드 갱신
  name: 'dashboard',
  key: (userId: string) => userId,
})
async getDashboard(userId: string) { ... }

// 조건부 캐싱
@Cacheable({
  ttl: 60,
  name: 'items',
  condition: (id: string) => id !== 'guest',   // 이 조건이 true일 때만 캐시 사용
  unless: (result) => result === null,          // 결과가 null이면 저장 안 함
})
async findItem(id: string) { ... }

// 멀티레벨 캐시
@Cacheable({ ttl: 60, name: 'hot-data', cacheManager: CacheManager.MULTI })
async getHotData(id: string) { ... }
```

### @CacheEvict

```typescript
// 특정 항목 삭제
@CacheEvict({ name: 'users', key: (id: string) => id })
async updateUser(id: string, data: UpdateUserDto) { ... }

// 네임스페이스 전체 삭제
@CacheEvict({ name: 'users', allEntries: true })
async deleteAllUsers() { ... }

// 여러 네임스페이스 동시 삭제
@CacheEvict({ name: ['users', 'profiles', 'sessions'], allEntries: true })
async clearAll() { ... }

// 메서드 실행 전 삭제
@CacheEvict({ name: 'users', allEntries: true, beforeInvocation: true })
async refreshUsers() { ... }
```

### 복합 사용

```typescript
@Cacheable({ ttl: 60, name: 'user-detail', key: (id: string) => id })
@CacheEvict({ name: 'user-list', allEntries: true })
async getUser(id: string) { ... }
// 개별 유저 캐시 저장 + 목록 캐시 무효화를 동시에 처리
```

---

## 옵션 레퍼런스

### @Cacheable

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `ttl` | `number` | `defaults.ttl` | 캐시 유효 시간 (초) |
| `staleTtl` | `number` | `ttl × staleMultiplier` | TTL 만료 후 stale 제공 시간 (초) |
| `swr` | `boolean` | 모듈 설정 | SWR 활성화 override |
| `name` | `string \| (...args) => string` | 자동 생성 | 캐시 네임스페이스 |
| `key` | `string \| (...args) => string` | 자동 해시 | 캐시 키 |
| `cacheManager` | `CacheManager` | `REDIS` | `REDIS` \| `MEMORY` \| `MULTI` |
| `condition` | `(...args) => boolean` | — | `true`일 때만 캐시 조회/저장 |
| `unless` | `(result, ...args) => boolean` | — | `true`이면 저장 건너뜀 |
| `compression` | `boolean \| { threshold?, level? }` | 모듈 설정 | 압축 설정 override |

### @CacheEvict

| 옵션 | 타입 | 기본값 | 설명 |
|------|------|--------|------|
| `name` | `string \| string[] \| (...args) => string \| string[]` | 자동 생성 | 삭제할 네임스페이스 |
| `key` | `string \| (...args) => string` | 자동 해시 | 삭제할 키. `allEntries: true`이면 무시 |
| `cacheManager` | `CacheManager` | `REDIS` | 삭제 대상 백엔드 |
| `allEntries` | `boolean` | `false` | 네임스페이스 전체 삭제 |
| `beforeInvocation` | `boolean` | `false` | 메서드 실행 전 삭제 여부 |
| `condition` | `(...args) => boolean` | — | `true`일 때만 삭제 |

---

## 동작 원리

### SWR + Single-flight

```
요청 A (캐시 fresh)       ──→ 캐시 반환

요청 B (TTL 만료, stale)  ──→ stale 데이터 즉시 반환
                             └─→ 락 획득 시도
                                  ├─ 성공: 백그라운드 갱신 → Pub/Sub 알림
                                  └─ 실패: Pub/Sub 대기 (타임아웃 시 폴링)

요청 C (staleTtl 만료)    ──→ 동기 갱신 후 반환
```

### 키 구조

```
{name}::{key}          캐시 데이터
{name}::{key}:lock     분산 락
pending:{name}::{key}  Pub/Sub 채널
```

---

## 라이선스

MIT
