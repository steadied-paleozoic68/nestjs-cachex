import type { CompressionConfig } from './types';

export interface CacheProvider {
  /**
   * 캐시 서버의 연결 상태를 확인(ping)합니다.
   * @return 연결 성공 시 'PONG' 또는 유사한 응답 문자열
   */
  ping(): Promise<string>;

  /**
   * 지정된 키에 대해 분산 잠금(lock)을 시도합니다.
   * @param key 잠금을 설정할 키
   * @param expire 잠금 만료 시간(초 단위, 선택 사항)
   * @return 잠금 획득 성공 시 true, 실패 시 false
   */
  tryLock(key: string, expire?: number): Promise<boolean>;

  /**
   * 지정된 잠금 키(lockKey)를 해제(unlock)합니다.
   * @param lockKey 해제할 잠금 키
   * @return 해제 성공 여부 (보통 1 또는 0)
   */
  unlock(lockKey: string): Promise<boolean>;

  /**
   * 지정된 키에 매핑된 값을 반환합니다.
   * @param key 반환할 값이 연관된 키
   * @return 지정된 키에 매핑된 값.
   * 또는 이 키에 대한 매핑이 없는 경우 null
   */
  get<T>(key: any): Promise<T | null>;

  /**
   * 지정된 값을 이 캐시의 지정된 키와 연관(저장)시킵니다.
   * @param key 지정된 값과 연관시킬 키
   * @param value 지정된 키와 연관시킬 값
   * @param ttl 만료 시간(초 단위, 선택 사항)
   * @param compressionOverride 압축 설정 오버라이드 (미설정 시 모듈 레벨 설정 사용)
   */
  put(key: any, value: any, ttl?: number, compressionOverride?: CompressionConfig): Promise<void>;

  /**
   * 이 키에 대한 매핑이 캐시에 존재할 경우 제거(evict)합니다.
   * @param key 캐시에서 제거할 매핑의 키
   */
  evict(key: any): Promise<void>;

  /**
   * 캐시의 모든 매핑(데이터)을 제거합니다.
   */
  clear(): Promise<void>;

  /**
   * 패턴과 일치하는 키를 삭제합니다 (Redis 전용 확장 기능일 수 있음)
   * @param pattern 삭제할 키의 패턴 (예: "store:A:*")
   */
  clearKeysByPattern(pattern: string): Promise<void>;

  /**
   * [Pub/Sub 싱글플라이트] 지정된 키에 대한 캐시 갱신 완료 알림을 기다립니다.
   * 락 획득에 실패한 서버가 폴링 대신 이벤트를 구독하여 대기합니다.
   * 미구현 시 자동으로 폴링 방식으로 폴백됩니다.
   * @param key 대기할 캐시 키
   * @param timeoutMs 최대 대기 시간 (ms) — 초과 시 reject
   */
  waitForResult?(key: string, timeoutMs: number): Promise<void>;

  /**
   * [Pub/Sub 싱글플라이트] 캐시 갱신 완료를 다른 서버에 알립니다.
   * 락을 획득해 캐시를 갱신한 서버가 완료 후 호출합니다.
   * @param key 갱신 완료된 캐시 키
   */
  notifyResult?(key: string): Promise<void>;
}
