import type { CacheableNameResolver, CacheKeyResolver, CacheManager } from './types';

export interface CacheableOption {
  /**
   * 캐시 신선 유지 시간 (초 단위) — SWR fresh 판단 기준
   * 글로벌 defaults.ttl이 설정된 경우 생략 가능
   * @example ttl: 60 // 60초 동안 fresh
   */
  ttl?: number;

  /**
   * 만료 후 stale 데이터를 제공할 추가 기간 (초 단위)
   * 미설정 시 모듈의 defaultStaleMultiplier × ttl 사용
   * physicalTtl(Redis 저장 TTL) = ttl + staleTtl
   * @example staleTtl: 300 // 만료 후 300초 동안 stale 데이터 반환하며 백그라운드 갱신
   */
  staleTtl?: number;

  /**
   * SWR 활성화 여부 (데코레이터 레벨 오버라이드)
   * 미설정 시 모듈 레벨 swr.enabled 설정 사용
   * @example swr: false // 이 메서드는 단순 캐시 사용
   */
  swr?: boolean;

  /**
   * 압축 설정 (데코레이터 레벨 오버라이드)
   * - false: 압축 비활성화
   * - { threshold, level }: 커스텀 압축 설정
   * - 미설정: 모듈 레벨 compression 설정 사용
   * @example compression: false // 작은 데이터는 압축 불필요
   * @example compression: { threshold: 1024 } // 1KB 이상만 압축
   */
  compression?: boolean | { threshold?: number; level?: number };

  /**
   * 사용할 캐시 매니저 타입
   * @default CacheManager.REDIS (또는 글로벌 defaults.cacheManager)
   * @example cacheManager: CacheManager.MEMORY
   */
  cacheManager?: CacheManager;

  /**
   * 캐시 네임스페이스/그룹명
   * 동일한 name을 가진 캐시들을 그룹화하여 관리
   *
   * 주의: name만 지정하고 key를 지정하지 않으면 메서드명과 파라미터를 기반으로 자동 키가 생성됩니다.
   *
   * @example
   * name: 'users' // 결과: users::메서드명_파라미터해시 형태로 저장
   * name: (userId: number) => `user-${userId}` // 결과: user-123::메서드명_파라미터해시 형태로 저장
   */
  name?: CacheableNameResolver;

  /**
   * 캐시 키 생성 방식
   * - 문자열: 고정 키 사용
   * - 함수: 메서드 파라미터를 기반으로 동적 키 생성
   * - 미지정: 메서드명과 파라미터 해시 조합 사용
   *
   * 주의: key가 지정되면 name과 조합하여 'name::key' 형태로 저장됩니다.
   *
   * @example
   * key: 'fixed-key'
   * key: (userId: number) => `user-${userId}`
   */
  key?: CacheKeyResolver;

  /**
   * 캐싱 조건 (메서드 실행 전 평가)
   * true 반환 시에만 캐시 확인 및 저장
   * @example condition: (userId: number) => userId > 0
   */
  condition?: (...args: any[]) => boolean;

  /**
   * 캐싱 제외 조건 (메서드 실행 후 평가)
   * true 반환 시 결과를 캐시에 저장하지 않음
   * @example unless: (result: User) => result == null
   */
  unless?: (result: any, ...args: any[]) => boolean;
}
