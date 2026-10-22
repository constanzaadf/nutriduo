"use client";

import { Bar, BarChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function WeekChart({ data, target }: { data: { day: string; planificado: number; comido: number }[]; target: number | null }) {
  return (
    <div className="h-64 w-full" role="img" aria-label="Energía planificada y registrada por día">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barGap={2}>
          <CartesianGrid vertical={false} stroke="#e4dac7" />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fill: "#5b6659", fontSize: 12 }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: "#5b6659", fontSize: 12 }} width={48} />
          <Tooltip cursor={{ fill: "rgba(228,218,199,0.35)" }} contentStyle={{ borderRadius: 12, border: "1px solid #e4dac7", background: "#fffcf6" }} formatter={(v) => `${Math.round(Number(v))} kcal`} />
          {target ? <ReferenceLine y={target} stroke="#1f2d24" strokeDasharray="4 4" label={{ value: "meta", position: "right", fill: "#5b6659", fontSize: 11 }} /> : null}
          <Bar dataKey="planificado" fill="#cbbda3" radius={[4, 4, 0, 0]} />
          <Bar dataKey="comido" fill="#5f7d58" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
