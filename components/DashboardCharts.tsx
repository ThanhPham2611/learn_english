"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Cell,
  LabelList,
} from "recharts";
import { cefrToNumber, numberToCefr } from "@/lib/cefr";
import type { SkillLevelPoint, AttemptPoint } from "@/lib/dashboard";

// Màu theo skill. Tránh đỏ/xanh dương — 2 màu đó đã mang nghĩa riêng ở màn Ôn từ
// vựng (đỏ = "chưa nhớ", xanh dương = "dễ"), dùng lại ở đây sẽ gây hiểu lầm ngầm.
const SKILL_COLOR: Record<string, string> = {
  writing: "#0d9488", // teal — trùng --primary
  speaking: "#f59e0b", // amber
  reading: "#c2410c", // cam — trùng --accent
  listening: "#64748b", // slate
};
const SKILL_LABEL: Record<string, string> = {
  writing: "Viết",
  speaking: "Nói",
  reading: "Đọc",
  listening: "Nghe",
};

const AXIS_STYLE = { fontSize: 12, fill: "var(--muted)" };

// ---- Biểu đồ cột: trình độ hiện tại từng kỹ năng trên thang A1-C2 ----
// Không dùng trục số 1-6 (CEFR là thang định danh có thứ tự, không phải khoảng
// cách đều — quy sang số rồi lại đọc ngược ra chữ chỉ làm người dùng phải "dịch"
// thêm 1 bước). Thay bằng nhãn CEFR in thẳng trên đầu mỗi cột.
export function SkillLevelBars({ data }: { data: SkillLevelPoint[] }) {
  const chartData = data.map((d) => ({
    label: d.label,
    value: d.level ? cefrToNumber(d.level) : 0,
    displayLevel: d.level ?? "—",
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ top: 20, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_STYLE} axisLine={{ stroke: "var(--border)" }} />
        <YAxis domain={[0, 6]} tick={false} axisLine={false} width={0} />
        <Tooltip
          formatter={(_value, _name, item) => [String(item.payload.displayLevel), "Trình độ"]}
          contentStyle={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 13,
          }}
        />
        <Bar dataKey="value" radius={[6, 6, 0, 0]} isAnimationActive={false}>
          <LabelList
            dataKey="displayLevel"
            position="top"
            style={{ fontSize: 13, fontWeight: 600, fill: "var(--text)" }}
          />
          {chartData.map((_, i) => (
            <Cell key={i} fill="var(--primary)" />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---- Biểu đồ đường: xu hướng điểm CEFR theo thời gian, mỗi kỹ năng 1 đường ----
// Không vẽ "placement" (test đầu vào): đây là mốc khởi điểm 1 lần, không phải kỹ
// năng luyện lặp lại, đưa vào legend chỉ gây nhiễu (chỉ có 1 điểm, không thể hiện xu hướng).
export function ProgressTrend({ data }: { data: AttemptPoint[] }) {
  const trendData = data.filter((p) => p.skill !== "placement");

  if (trendData.length === 0) {
    return (
      <p className="flex h-[220px] items-center justify-center text-sm text-muted">
        Chưa có dữ liệu — hãy làm vài bài luyện tập.
      </p>
    );
  }

  // Gộp theo ngày: mỗi ngày 1 dòng, mỗi kỹ năng 1 cột điểm (lấy lượt gần nhất trong ngày).
  const byDate = new Map<string, Record<string, number | string>>();
  for (const p of trendData) {
    const row = byDate.get(p.date) ?? { date: p.date };
    row[p.skill] = p.score;
    byDate.set(p.date, row);
  }
  const chartData = Array.from(byDate.values()).sort((a, b) =>
    String(a.date).localeCompare(String(b.date))
  );
  const skills = Array.from(new Set(trendData.map((p) => p.skill)));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="date" tick={AXIS_STYLE} axisLine={{ stroke: "var(--border)" }} />
        <YAxis
          domain={[0, 6]}
          ticks={[1, 2, 3, 4, 5, 6]}
          tickFormatter={(v) => numberToCefr(v)}
          tick={AXIS_STYLE}
          axisLine={{ stroke: "var(--border)" }}
        />
        <Tooltip
          formatter={(value) => numberToCefr(Number(value))}
          labelFormatter={(label) => `Ngày ${label}`}
          contentStyle={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 8,
            fontSize: 13,
          }}
        />
        <Legend
          formatter={(value) => SKILL_LABEL[value] ?? value}
          wrapperStyle={{ fontSize: 12 }}
        />
        {skills.map((s) => (
          <Line
            key={s}
            type="monotone"
            dataKey={s}
            name={s}
            stroke={SKILL_COLOR[s] ?? "#64748b"}
            strokeWidth={2}
            dot={{ r: 3 }}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
