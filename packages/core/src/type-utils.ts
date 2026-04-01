export type MaybePromise<T> = T | Promise<T>;

export type UnionToIntersection<T> = (
  T extends unknown
    ? (value: T) => void
    : never
) extends (value: infer TIntersection) => void
  ? TIntersection
  : never;
