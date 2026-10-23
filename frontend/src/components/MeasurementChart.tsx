import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { formatNumber } from "../lib/health";
import { formatTime, formatWhen } from "../lib/time";

export interface ChartPoint {
  at: number;
  value: number;
  value2?: number | null;
  /** Registrado neste aparelho e ainda não enviado. */
  pending?: boolean;
  by?: string | null;
}

export interface ChartDose {
  at: number;
  label: string;
}

export interface ChartReference {
  value: number;
  value2?: number | null;
  label: string;
}

interface Props {
  title: string;
  unit: string;
  decimals: number;
  points: ChartPoint[];
  doses: ChartDose[];
  reference: ChartReference | null;
  from: number;
  to: number;
  /** Nomes das duas séries (pressão arterial). */
  seriesLabels?: [string, string];
}

const H = 244;
const M = { left: 44, right: 14, top: 14, bottom: 60 };
const PLOT_BOTTOM = H - M.bottom;
const DOSE_Y = PLOT_BOTTOM + 22;

/** Passo "redondo" (1, 2 ou 5 × 10^k) para cerca de 4 divisões; sem 2,5 para o rótulo não arredondar. */
export function niceTicks(lo: number, hi: number, count = 4): number[] {
  if (lo === hi) {
    lo -= 1;
    hi += 1;
  }
  const raw = (hi - lo) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const start = Math.floor(lo / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= hi + step * 0.5; v += step) ticks.push(Number(v.toFixed(6)));
  if (ticks[ticks.length - 1] < hi) ticks.push(Number((ticks[ticks.length - 1] + step).toFixed(6)));
  return ticks;
}

/** Marcas do eixo do tempo no fuso do aparelho. */
export function timeTicks(from: number, to: number, max = 7): { at: number; label: string }[] {
  const span = to - from;
  const hour = 3_600_000;
  const ticks: { at: number; label: string }[] = [];
  if (span <= 36 * hour) {
    const every = [1, 2, 3, 6, 12].find((h) => span / (h * hour) <= max) ?? 12;
    const d = new Date(from);
    d.setMinutes(0, 0, 0);
    while (d.getTime() < from || d.getHours() % every !== 0) d.setHours(d.getHours() + 1);
    for (; d.getTime() <= to; d.setHours(d.getHours() + every)) {
      ticks.push({ at: d.getTime(), label: `${String(d.getHours()).padStart(2, "0")}h` });
    }
    return ticks;
  }
  const days = Math.ceil(span / (24 * hour));
  const every = [1, 2, 3, 7, 14].find((n) => days / n <= max) ?? 14;
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  if (d.getTime() < from) d.setDate(d.getDate() + 1);
  for (let i = 0; d.getTime() <= to; d.setDate(d.getDate() + 1), i++) {
    if (i % every !== 0) continue;
    const label = days <= 8
      ? d.toLocaleDateString("pt-BR", { weekday: "short", day: "numeric" }).replace(".", "")
      : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
    ticks.push({ at: d.getTime(), label });
  }
  return ticks;
}

/**
 * Série de aferições no tempo, com a linha de referência da família e as doses
 * administradas no mesmo eixo. Só mostra os dados; não classifica valores.
 */
/**
 * Janela do eixo do tempo: o período escolhido, aproximado à extensão dos
 * dados, para que medidas de poucas horas não fiquem espremidas num canto.
 */
export function timeWindow(points: { at: number }[], from: number, to: number): [number, number] {
  if (points.length === 0) return [from, to];
  const first = Math.min(...points.map((p) => p.at));
  const last = Math.max(...points.map((p) => p.at));
  const end = Math.min(to, Math.max(last, Date.now()));
  const pad = Math.max(30 * 60_000, (end - first) * 0.08);
  return [Math.max(from, first - pad), Math.min(to, end + pad / 2)];
}

export function MeasurementChart(props: Props) {
  const { title, unit, decimals, points, reference, seriesLabels } = props;
  const [from, to] = useMemo(() => timeWindow(props.points, props.from, props.to), [props.points, props.from, props.to]);
  const doses = props.doses.filter((d) => d.at >= from && d.at <= to);
  const [active, setActive] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // Desenha na largura real (em px): texto e marcadores mantêm o tamanho no celular.
  const [W, setW] = useState(340);
  const tableId = useId();

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const observer = new ResizeObserver(([entry]) => setW(Math.max(260, Math.round(entry.contentRect.width))));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  const yTicks = useMemo(() => {
    const values = points.flatMap((p) => (p.value2 != null ? [p.value, p.value2] : [p.value]));
    if (reference) values.push(reference.value, ...(reference.value2 != null ? [reference.value2] : []));
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const pad = (hi - lo) * 0.1;
    return niceTicks(lo - pad, hi + pad);
  }, [points, reference]);
  const yMin = yTicks[0];
  const yMax = yTicks[yTicks.length - 1];

  const x = (at: number) => M.left + ((at - from) / (to - from)) * (W - M.left - M.right);
  const y = (v: number) => M.top + (1 - (v - yMin) / (yMax - yMin)) * (PLOT_BOTTOM - M.top);
  const fmt = (v: number) => formatNumber(v, decimals);
  const withUnit = (v: string) => (unit === "%" ? `${v}%` : `${v} ${unit}`);
  const valueText = (p: ChartPoint) => withUnit(p.value2 != null ? `${fmt(p.value)}/${fmt(p.value2)}` : fmt(p.value));

  const line = (key: "value" | "value2") =>
    points.filter((p) => p[key] != null).map((p, i) => `${i === 0 ? "M" : "L"}${x(p.at).toFixed(1)},${y(p[key]!).toFixed(1)}`).join(" ");

  function onPointer(event: PointerEvent<SVGRectElement>) {
    const svg = svgRef.current;
    if (!svg || points.length === 0) return;
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    let best = 0;
    points.forEach((p, i) => {
      if (Math.abs(x(p.at) - px) < Math.abs(x(points[best].at) - px)) best = i;
    });
    setActive(best);
  }

  const current = active != null ? points[active] : null;
  const lastDoseBefore = current
    ? doses.filter((d) => d.at <= current.at && current.at - d.at <= 24 * 3_600_000).sort((a, b) => b.at - a.at)[0]
    : undefined;
  const latest = points[points.length - 1];
  const summary = points.length === 0 ? `${title}: nenhuma aferição no período.`
    : `${title}: ${points.length} ${points.length === 1 ? "aferição" : "aferições"}; a última, ${valueText(latest)} em ${formatWhen(new Date(latest.at).toISOString())}.`;

  return (
    <figure className="chart">
      {seriesLabels && (
        <ul className="legend" aria-label="Legenda">
          <li><span className="swatch swatch-1" aria-hidden="true" />{seriesLabels[0]}</li>
          <li><span className="swatch swatch-2" aria-hidden="true" />{seriesLabels[1]}</li>
        </ul>
      )}
      <div className="chart-plot" ref={boxRef}>
        <svg ref={svgRef} width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
          {yTicks.map((t) => (
            <g key={t}>
              <line className="grid" x1={M.left} x2={W - M.right} y1={y(t)} y2={y(t)} />
              <text className="axis" x={M.left - 6} y={y(t) + 4} textAnchor="end">{fmt(t)}</text>
            </g>
          ))}
          {timeTicks(from, to, W < 420 ? 4 : 7).map((t) => (
            <text key={t.at} className="axis" x={x(t.at)} y={H - 8} textAnchor="middle">{t.label}</text>
          ))}

          {reference && [reference.value, reference.value2].filter((v): v is number => v != null).map((v, i) => (
            <g key={i}>
              <line className="reference" x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} />
              <text className="reference-label" x={M.left + 6} y={y(v) - 5}>
                {withUnit(fmt(v))}{i === 0 ? ` · ${reference.label}` : ""}
              </text>
            </g>
          ))}

          {doses.map((d, i) => (
            <path key={i} className="dose-mark" d={`M${x(d.at)},${DOSE_Y - 6} l5,9 h-10 z`}>
              <title>{`${d.label} · ${formatWhen(new Date(d.at).toISOString())}`}</title>
            </path>
          ))}
          {doses.length > 0 && <text className="axis" x={M.left - 6} y={DOSE_Y + 3} textAnchor="end">doses</text>}

          {current && <line className="crosshair" x1={x(current.at)} x2={x(current.at)} y1={M.top} y2={PLOT_BOTTOM} />}

          <path className="series series-1" d={line("value")} />
          {seriesLabels && <path className="series series-2" d={line("value2")} />}
          {points.map((p, i) => (
            <g key={i}>
              <circle className={`marker marker-1 ${p.pending ? "pending" : ""}`} cx={x(p.at)} cy={y(p.value)} r={i === active ? 6 : 4.5} />
              {p.value2 != null && (
                <circle className={`marker marker-2 ${p.pending ? "pending" : ""}`} cx={x(p.at)} cy={y(p.value2)} r={i === active ? 6 : 4.5} />
              )}
            </g>
          ))}

          <rect className="hit" x={M.left} y={M.top} width={W - M.left - M.right} height={DOSE_Y + 8 - M.top}
            onPointerMove={onPointer} onPointerDown={onPointer} onPointerLeave={() => setActive(null)} />
        </svg>
        {current && (
          <div className={`tooltip ${x(current.at) > W * 0.6 ? "tooltip-left" : x(current.at) < W * 0.4 ? "tooltip-right" : ""}`}
            style={{ left: x(current.at) }} role="status">
            <strong>{valueText(current)}</strong>
            {seriesLabels && <span className="muted small">{seriesLabels[0]}/{seriesLabels[1]}</span>}
            <span>{formatWhen(new Date(current.at).toISOString())}{current.by ? ` · ${current.by}` : ""}</span>
            {current.pending && <span className="small">Aguardando envio</span>}
            {lastDoseBefore && (
              <span className="small">Última dose antes: {lastDoseBefore.label} às {formatTime(new Date(lastDoseBefore.at).toISOString())}</span>
            )}
          </div>
        )}
      </div>
      <figcaption className="row between">
        <span className="muted small">{doses.length > 0 ? "▲ dose administrada no período" : ""}</span>
        <button type="button" className="link small" aria-expanded={showTable} aria-controls={tableId}
          onClick={() => setShowTable(!showTable)}>
          {showTable ? "Ocultar valores" : "Ver valores"}
        </button>
      </figcaption>
      {showTable && (
        <table id={tableId} className="values">
          <thead><tr><th>Quando</th><th>Valor</th><th>Quem</th></tr></thead>
          <tbody>
            {[...points].reverse().map((p, i) => (
              <tr key={i}>
                <td>{formatWhen(new Date(p.at).toISOString())}</td>
                <td>{valueText(p)}{p.pending ? " (aguardando envio)" : ""}</td>
                <td>{p.by ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}
