// Pure SVG, server-rendered. No client JS.
type Props = {
  values: number[];      // projection net worth by year
  height?: number;
  width?: number;
};

export default function NetWorthSparkline({ values, height = 48, width = 160 }: Props) {
  if (!values.length) return <div className="h-12 text-xs text-gray-500">No projection</div>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const step = width / Math.max(values.length - 1, 1);

  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`)
    .join(" ");

  const last = values[values.length - 1];
  const lastX = (values.length - 1) * step;
  const lastY = height - ((last - min) / span) * height;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <polyline fill="none" stroke="currentColor" strokeWidth="1.5" className="text-blue-400" points={points} />
      <circle cx={lastX} cy={lastY} r="2.5" className="fill-blue-300" />
    </svg>
  );
}
