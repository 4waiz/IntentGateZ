import type { JsonObject, JsonValue } from "../../api/types";
import { api } from "../../api/client";

function isObj(v: JsonValue): v is JsonObject {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isScalar(v: JsonValue): v is string | number | boolean | null {
  return v === null || typeof v !== "object";
}

export function fmtScalar(v: string | number | boolean | null): string {
  if (v === null) return "null";
  if (typeof v === "number") {
    if (Number.isInteger(v)) return v.toLocaleString("en-US");
    return Math.abs(v) >= 100 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(3) : v.toPrecision(4);
  }
  if (typeof v === "boolean") return v ? "true" : "false";
  return v;
}

/** Find chart names referenced anywhere in the results (".png" strings or "charts" arrays). */
export function collectChartNames(v: JsonValue, out = new Set<string>(), depth = 0): Set<string> {
  if (depth > 6) return out;
  if (typeof v === "string") {
    const m = v.match(/([A-Za-z0-9_-]+)\.png$/);
    if (m) out.add(m[1]);
  } else if (Array.isArray(v)) {
    for (const x of v) collectChartNames(x, out, depth + 1);
  } else if (isObj(v)) {
    for (const [k, x] of Object.entries(v)) {
      if ((k === "charts" || k === "chart_names" || k === "plots") && Array.isArray(x)) {
        for (const n of x) if (typeof n === "string" && /^[A-Za-z0-9_-]+$/.test(n)) out.add(n);
      }
      collectChartNames(x, out, depth + 1);
    }
  }
  return out;
}

function Table({ rows }: { rows: JsonObject[] }) {
  const cols: string[] = [];
  for (const r of rows.slice(0, 50)) for (const [k, v] of Object.entries(r)) if (isScalar(v) && !cols.includes(k) && cols.length < 12) cols.push(k);
  return (
    <div className="overflow-x-auto rounded-[4px] border border-line">
      <table className="w-full border-collapse text-[11.5px]">
        <thead>
          <tr className="bg-white/[0.03]">
            {cols.map((c) => (
              <th key={c} className="border-b border-line px-2.5 py-1.5 text-left font-medium whitespace-nowrap text-muted">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 100).map((r, i) => (
            <tr key={i} className="border-b border-white/[0.04] last:border-0">
              {cols.map((c) => {
                const v = r[c];
                return (
                  <td key={c} className="ig-mono px-2.5 py-1 whitespace-nowrap text-fg-2">
                    {v === undefined ? "" : isScalar(v) ? fmtScalar(v) : "…"}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function JsonView({ value, depth = 0 }: { value: JsonValue; depth?: number }) {
  if (isScalar(value)) return <span className="ig-mono text-[11.5px] text-fg">{fmtScalar(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-[11.5px] text-dim">empty</span>;
    if (value.every(isObj)) return <Table rows={value} />;
    if (value.every(isScalar))
      return (
        <span className="ig-mono text-[11.5px] break-words text-fg-2">
          [{value.slice(0, 24).map((x) => fmtScalar(x)).join(", ")}
          {value.length > 24 ? ", …" : ""}]
        </span>
      );
    return <pre className="ig-mono max-h-48 overflow-auto text-[10.5px] text-fg-2">{JSON.stringify(value, null, 2).slice(0, 4000)}</pre>;
  }
  const entries = Object.entries(value);
  const scalars = entries.filter(([, v]) => isScalar(v) || (Array.isArray(v) && v.every(isScalar) && v.length <= 12));
  const nested = entries.filter(([, v]) => !(isScalar(v) || (Array.isArray(v) && v.every(isScalar) && v.length <= 12)));
  if (depth > 3) return <pre className="ig-mono max-h-48 overflow-auto text-[10.5px] text-fg-2">{JSON.stringify(value, null, 2).slice(0, 4000)}</pre>;
  return (
    <div className="flex flex-col gap-3">
      {scalars.length > 0 && (
        <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 sm:grid-cols-2 xl:grid-cols-3">
          {scalars.map(([k, v]) => (
            <div key={k} className="flex items-baseline justify-between gap-3 border-b border-white/[0.04] py-1">
              <span className="truncate text-[11.5px] text-muted" title={k}>
                {k}
              </span>
              <JsonView value={v} depth={depth + 1} />
            </div>
          ))}
        </div>
      )}
      {nested.map(([k, v]) => (
        <div key={k}>
          <div className="ig-label-sm mb-1.5">{k}</div>
          <div className="border-l border-line pl-3">
            <JsonView value={v} depth={depth + 1} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChartGallery({ names }: { names: string[] }) {
  if (!names.length) return null;
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      {names.map((n) => (
        <figure key={n} className="ig-card overflow-hidden">
          <img src={api.benchmarkChartUrl(n)} alt={n} className="block w-full bg-white" loading="lazy" onError={(e) => ((e.currentTarget.parentElement as HTMLElement).style.display = "none")} />
          <figcaption className="ig-mono border-t border-line px-2.5 py-1.5 text-[10.5px] text-muted">{n}.png</figcaption>
        </figure>
      ))}
    </div>
  );
}
