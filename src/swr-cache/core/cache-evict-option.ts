import type { CacheEvictNameResolver, CacheKeyResolver, CacheManager } from './types';

export interface CacheEvictOption {
  /**
   * 사용할 캐시 매니저 타입
   * @default CacheManager.REDIS
   */
  cacheManager?: CacheManager;

  /**
   * 캐시 네임스페이스/그룹명
   * - allEntries가 true일 때: 이 name의 모든 캐시가 삭제됨
   * - allEntries가 false이고 key가 없을 때: name과 메서드명/파라미터를 조합한 특정 캐시만 삭제
   * - 문자열: 고정 name 사용
   * - 배열: 여러 name 사용
   * - 함수: 메서드 파라미터를 기반으로 동적 name 생성
   *
   * 주의: name만 지정하고 key를 지정하지 않으면 메서드명과 파라미터를 기반으로 자동 키가 생성됩니다.
   *
   * @example
   * name: 'users' // allEntries=false 시: users::메서드명_파라미터해시 삭제
   * name: ['users', 'profiles']
   * name: (userId: number) => `user-${userId}`
   */
  name?: CacheEvictNameResolver;

  /**
   * 삭제할 캐시 키 생성 방식
   * - allEntries가 true이면 이 속성은 무시됨
   * - 미지정 시 메서드명과 파라미터 해시 조합 사용
   *
   * 주의: key가 지정되면 name과 조합하여 'name::key' 형태의 캐시를 삭제합니다.
   *
   * @example
   * key: 'fixed-key'
   * key: (userId: number) => `user-${userId}`
   */
  key?: CacheKeyResolver;

  /**
   * 캐시 삭제 조건 (메서드 실행 전 평가)
   * true 반환 시에만 캐시 삭제
   * @example condition: (userId: number) => userId > 0
   */
  condition?: (...args: any[]) => boolean;

  /**
   * 모든 엔트리 삭제 여부
   * true: name에 해당하는 모든 캐시 엔트리 삭제 (key 속성 무시)
   * false: key로 지정된 특정 캐시만 삭제
   * @default false
   * @example allEntries: true // 'users:*' 패턴의 모든 캐시 삭제
   */
  allEntries?: boolean;

  /**
   * 메서드 호출 전 캐시 삭제 여부
   * true: 메서드 실행 전에 캐시 삭제 (실행 실패해도 캐시는 삭제됨)
   * false: 메서드 실행 후에 캐시 삭제 (실행 성공 시에만 삭제)
   * @default false
   */
  beforeInvocation?: boolean;
}
