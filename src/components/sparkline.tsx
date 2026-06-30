// Inline SVG sparkline — feed-only chart surface (issue #4).

type SparklineProps = {
  series: number[];
  width?: number;
  height?: number;
  className?: string;
};

export function Sparkline({
  series,
  width = 120,
  height = 36,
  className,
}: SparklineProps) {
  if (series.length < 2) {
    return (
      <svg
        width={width}
        height={height}
        className={className}
        aria-hidden
      />
    );
  }

  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;

  const points = series
    .map((value, index) => {
      const x = (index / (series.length - 1)) * width;
      const y = height - ((value - min) / range) * (height - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");

  const trendUp = series[series.length - 1]! >= series[0]!;
  const stroke = trendUp ? "#37E0C8" : "#f8728b";

  return (
    <svg
      width={width}
      height={height}
      className={className}
      aria-hidden
      viewBox={`0 0 ${width} ${height}`}
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        points={points}
      />
    </svg>
  );
}
