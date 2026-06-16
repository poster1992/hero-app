"use client";

import { Cell, Pie, PieChart } from "recharts";

interface DonutStatProps {
  label: string;
  description: string;
  value: number;
  color: string;
  trackColor?: string;
}

export default function DonutStat({
  label,
  description,
  value,
  color,
  trackColor = "#27272a",
}: DonutStatProps) {
  const ringValue = Math.max(0, Math.min(100, value));
  const data = [
    { name: "value", value: ringValue },
    { name: "rest", value: 100 - ringValue },
  ];

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-24 w-24 shrink-0">
        <PieChart width={96} height={96}>
          <Pie
            data={data}
            dataKey="value"
            cx="50%"
            cy="50%"
            innerRadius={32}
            outerRadius={44}
            startAngle={90}
            endAngle={-270}
            stroke="none"
            isAnimationActive={false}
          >
            <Cell fill={color} />
            <Cell fill={trackColor} />
          </Pie>
        </PieChart>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-semibold text-gray-50">
            {Math.round(value)}%
          </span>
        </div>
      </div>
      <div>
        <p className="text-sm font-medium text-gray-200">{label}</p>
        <p className="mt-1 text-xs text-gray-500">{description}</p>
      </div>
    </div>
  );
}
