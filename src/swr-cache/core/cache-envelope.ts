/**
 * 캐시 데이터를 래핑하는 엔벨로프 클래스
 * SWR(Stale-While-Revalidate) 전략을 지원하기 위한 메타데이터를 포함합니다.
 */
export class CacheEnvelope {
  constructor(
    public readonly data: unknown,
    public readonly createdAt: number,
    public readonly expiresAt: number,
  ) {}

  /**
   * 팩토리 메서드: TTL을 적용하여 새 엔벨로프 생성
   * 논리 TTL은 예측 가능해야 하므로 지터를 적용하지 않습니다.
   * 물리 TTL 지터는 CacheOperations.resolvePhysicalTtl()에서 처리합니다.
   */
  static create(data: unknown, ttl: number): CacheEnvelope {
    const now = Date.now();
    return new CacheEnvelope(data, now, now + ttl * 1000);
  }

  /**
   * plain object에서 CacheEnvelope 인스턴스 복원
   */
  static fromObject(obj: any): CacheEnvelope | null {
    if (!CacheEnvelope.isValidObject(obj)) {
      return null;
    }

    return new CacheEnvelope(obj.data, obj.createdAt, obj.expiresAt);
  }

  /**
   * 객체가 유효한 CacheEnvelope 구조인지 검증
   */
  static isValidObject(
    obj: unknown,
  ): obj is { data: unknown; createdAt: number; expiresAt: number } {
    return (
      obj !== null &&
      typeof obj === 'object' &&
      'data' in obj &&
      'createdAt' in obj &&
      'expiresAt' in obj &&
      typeof (obj as any).createdAt === 'number' &&
      typeof (obj as any).expiresAt === 'number'
    );
  }

  /**
   * 캐시가 논리적으로 만료되었는지 확인
   */
  isStale(): boolean {
    return Date.now() > this.expiresAt;
  }

  /**
   * 캐시가 아직 유효한지 확인
   */
  isFresh(): boolean {
    return !this.isStale();
  }

  /**
   * 직렬화를 위한 plain object로 변환
   */
  toObject(): { data: unknown; createdAt: number; expiresAt: number } {
    return {
      data: this.data,
      createdAt: this.createdAt,
      expiresAt: this.expiresAt,
    };
  }
}
