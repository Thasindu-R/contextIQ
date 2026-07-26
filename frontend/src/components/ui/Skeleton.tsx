// Skeleton: a pulsing placeholder for content that is still loading.
// Single responsibility: presentational shimmer block.

interface SkeletonProps {
  /** Sizing utilities -- a skeleton is only ever a box of some size. */
  className?: string;
}

export default function Skeleton({ className = "" }: SkeletonProps): JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={`block animate-pulse rounded bg-slate-200 dark:bg-slate-700 ${className}`}
    />
  );
}
