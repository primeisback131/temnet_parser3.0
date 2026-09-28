import { FileExcelOutlined } from "@ant-design/icons";
import { Alert, App, Button, Drawer, Empty, Segmented, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { CSSProperties, ReactNode } from "react";
import { useState } from "react";
import { exportWorkbook } from "../lib/excel";
import QueryError from "./QueryError";

/** Where rows without an organization are grouped. */
const NO_GROUP = "Без организации";

export interface Breakdown<T> {
  title: string;
  /** The row's label here; null leaves the row out. */
  of: (row: T) => string | null;
  /** Fixed label order (time buckets); otherwise the biggest first. */
  order?: string[];
  /**
   * rate - share of the label's own base the card counts (default for a rate card);
   * share - the card's count per label (default otherwise);
   * spread - how the card's base rows spread over the labels.
   */
  mode?: "rate" | "share" | "spread";
}

export interface Fact {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}

/** Everything a card's drill-down shows; built by the page, rendered here. */
export interface DrillSpec<T> {
  title: string;
  accent: string;
  rows: T[];
  loading: boolean;
  error?: unknown;
  /** Set when the server cut the list: what to tell the user. */
  truncated?: string | null;
  rowKey: (row: T) => string;
  groupOf: (row: T) => string | null;
  /** What the card counts per row: 1/0 for a ticket, messages for a client. */
  count: (row: T) => number;
  countTitle: string;
  /** The card's denominator per row when the card is a share; rows at 0 are outside it. */
  base?: (row: T) => number;
  baseTitle?: string;
  rateTitle?: string;
  /** Headline figures of the rows in view (after the bar filters). */
  facts: (rows: T[]) => Fact[];
  breakdowns: Breakdown<T>[];
  /** The list's default filter: the rows to look at first. */
  focus?: { label: string; test: (row: T) => boolean };
  columns: ColumnsType<T>;
  /** One Excel row, headers as keys. */
  excel: (row: T) => Record<string, unknown>;
  fileName: string;
}

interface Props<T> {
  spec: DrillSpec<T>;
  subtitle: string;
  /** No group is selected: split everything by organization. */
  byGroup: boolean;
  onClose: () => void;
}

interface Tally {
  label: string;
  value: number;
  base: number;
}

const num = (n: number) => n.toLocaleString("ru-RU");
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Sums the card's count and base per label. */
function tally<T>(rows: T[], of: (row: T) => string | null, spec: DrillSpec<T>): Tally[] {
  const map = new Map<string, Tally>();
  for (const row of rows) {
    const label = of(row);
    if (label == null) continue;
    const t = map.get(label) ?? { label, value: 0, base: 0 };
    t.value += spec.count(row);
    t.base += spec.base ? spec.base(row) : 0;
    map.set(label, t);
  }
  return [...map.values()];
}

const modeOf = <T,>(b: Breakdown<T>, spec: DrillSpec<T>) => b.mode ?? (spec.base ? "rate" : "share");

export default function MetricDrawer<T>({ spec, subtitle, byGroup, onClose }: Props<T>) {
  const { message } = App.useApp();
  // Clicked bars, by breakdown index.
  const [filters, setFilters] = useState<Record<number, string>>({});
  const [focused, setFocused] = useState(true);
  const [view, setView] = useState<"groups" | "list">("groups");
  const [exporting, setExporting] = useState(false);

  const groupOf = (row: T) => spec.groupOf(row) ?? NO_GROUP;
  const population = spec.base ? spec.rows.filter((r) => spec.base!(r) > 0) : spec.rows;
  // A bar of a rate breakdown narrows the base: every figure then describes
  // its rows. A share/spread bar of a rate card covers only part of the base
  // (the expired, the answered within a bucket); narrowing by it would turn
  // every rate into 100%, so it filters the list alone.
  const narrows = (i: number) => !spec.base || modeOf(spec.breakdowns[i], spec) === "rate";
  const active = Object.entries(filters).map(([i, label]) => ({ i: Number(i), label }));
  // A list-only bar leaves the organization counts as they are; a column says
  // how many rows of each it picked, so an expanded row matches something.
  const listOnly = active.some(({ i }) => !narrows(i));
  const passes = (row: T, which: (i: number) => boolean) =>
    active.every(({ i, label }) => !which(i) || spec.breakdowns[i].of(row) === label);

  const filtered = population.filter((r) => passes(r, narrows));
  const listed = filtered.filter(
    (r) => passes(r, (i) => !narrows(i)) && (!spec.focus || !focused || spec.focus.test(r)),
  );
  const total = filtered.reduce((n, r) => n + spec.count(r), 0);

  const toggle = (i: number, label: string) => {
    // A list-only bar can contradict the default focus ('до 5 мин' holds only
    // the fast answers, the focus only the slow ones): picking it shows all.
    if (!narrows(i) && filters[i] !== label) setFocused(false);
    setFilters(({ [i]: current, ...rest }) => (current === label ? rest : { ...rest, [i]: label }));
  };

  const rowsOf = new Map<string, T[]>();
  for (const row of listed) {
    const key = groupOf(row);
    rowsOf.set(key, rowsOf.get(key) ?? []);
    rowsOf.get(key)!.push(row);
  }
  const groups = tally(filtered, groupOf, spec)
    .map((t) => ({ ...t, rows: rowsOf.get(t.label) ?? [] }))
    .sort((a, b) => b.value - a.value || b.base - a.base);
  type Group = (typeof groups)[number];
  const share = (g: Group) => (spec.base ? pct(g.value, g.base) : pct(g.value, total));
  const shareTitle = spec.base ? (spec.rateTitle ?? "Доля") : "Доля";

  const groupColumns: ColumnsType<Group> = [
    { title: "Организация", dataIndex: "label", sorter: (a, b) => a.label.localeCompare(b.label) },
    {
      title: spec.countTitle,
      dataIndex: "value",
      align: "right",
      sorter: (a, b) => a.value - b.value,
      render: num,
    },
    ...(spec.base
      ? ([
          {
            title: spec.baseTitle,
            dataIndex: "base",
            align: "right",
            sorter: (a, b) => a.base - b.base,
            render: num,
          },
        ] as ColumnsType<Group>)
      : []),
    ...(listOnly
      ? ([
          {
            title: "Отобрано",
            key: "picked",
            align: "right",
            sorter: (a, b) => a.rows.length - b.rows.length,
            render: (_, g) => num(g.rows.length),
          },
        ] as ColumnsType<Group>)
      : []),
    {
      title: shareTitle,
      key: "share",
      width: 190,
      sorter: (a, b) => share(a) - share(b),
      render: (_, g) => <Meter value={share(g)} text={`${share(g)}%`} />,
    },
  ];

  const listColumns: ColumnsType<T> = byGroup
    ? [
        {
          title: "Организация",
          key: "group",
          sorter: (a, b) => groupOf(a).localeCompare(groupOf(b)),
          render: (_, row) => groupOf(row),
        },
        ...spec.columns,
      ]
    : spec.columns;

  const exportExcel = async () => {
    setExporting(true);
    try {
      await exportWorkbook(
        [
          ...(byGroup
            ? [
                {
                  name: "По организациям",
                  rows: groups.map((g) => ({
                    Организация: g.label,
                    [spec.countTitle]: g.value,
                    ...(spec.base ? { [spec.baseTitle ?? "База"]: g.base } : {}),
                    ...(listOnly ? { Отобрано: g.rows.length } : {}),
                    [`${shareTitle}, %`]: share(g),
                  })),
                },
              ]
            : []),
          { name: "Список", rows: listed.map((r) => ({ Организация: groupOf(r), ...spec.excel(r) })) },
        ],
        spec.fileName,
      );
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Не удалось выгрузить Excel");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      width="min(1100px, 100vw)"
      title={
        <div>
          <div>{spec.title}</div>
          <div className="meta" style={{ fontWeight: 400 }}>
            {subtitle}
          </div>
        </div>
      }
      extra={
        <Button
          icon={<FileExcelOutlined />}
          loading={exporting}
          disabled={listed.length === 0}
          onClick={() => void exportExcel()}
        >
          Excel
        </Button>
      }
    >
      <div className="drill" style={{ "--drill-accent": spec.accent } as CSSProperties}>
        <QueryError error={spec.error} />
        {spec.truncated && (
          <Alert type="warning" showIcon style={{ marginBottom: 16 }} message={spec.truncated} />
        )}

        {/* Figures of an empty list would read as real zeros next to the card. */}
        {!spec.loading && !(spec.error && spec.rows.length === 0) && (
          <>
        <div className="facts" style={{ marginTop: 0 }}>
          {spec.facts(filtered).map((f) => (
            <div key={f.label}>
              <span className="meta">{f.label}</span>
              <b>{f.value}</b>
              {f.hint != null && <span className="meta">{f.hint}</span>}
            </div>
          ))}
        </div>

        {spec.breakdowns.length > 0 && (
          <div className="drill-breakdowns">
            {spec.breakdowns.map((b, i) => (
              <BreakdownBars
                key={b.title}
                breakdown={b}
                items={tally(
                  population.filter((r) => passes(r, (j) => j !== i && narrows(j))),
                  b.of,
                  spec,
                )}
                spec={spec}
                selected={filters[i]}
                onPick={(label) => toggle(i, label)}
              />
            ))}
          </div>
        )}
          </>
        )}

        <div className="drill-toolbar">
          <Space wrap size={8}>
            {byGroup && (
              <Segmented
                value={view}
                onChange={(v) => setView(v as "groups" | "list")}
                options={[
                  { label: "По организациям", value: "groups" },
                  { label: "Одним списком", value: "list" },
                ]}
              />
            )}
            {spec.focus && (
              <Segmented
                value={focused ? "focus" : "all"}
                onChange={(v) => setFocused(v === "focus")}
                options={[
                  { label: spec.focus.label, value: "focus" },
                  { label: "Все", value: "all" },
                ]}
              />
            )}
            {active.map(({ i, label }) => (
              <Tag key={i} closable onClose={() => toggle(i, label)} style={{ marginInlineEnd: 0 }}>
                {spec.breakdowns[i].title}: {label}
              </Tag>
            ))}
          </Space>
          <span className="meta">
            строк <b>{num(listed.length)}</b>
          </span>
        </div>

        {byGroup && view === "groups" ? (
          <Table
            rowKey="label"
            size="small"
            loading={spec.loading}
            columns={groupColumns}
            dataSource={groups}
            pagination={groups.length > 25 ? { pageSize: 25, showSizeChanger: false } : false}
            expandable={{
              rowExpandable: (g) => g.rows.length > 0,
              expandedRowRender: (g) => (
                <Table
                  rowKey={spec.rowKey}
                  size="small"
                  columns={spec.columns}
                  dataSource={g.rows}
                  pagination={g.rows.length > 10 ? { pageSize: 10, showSizeChanger: false } : false}
                  scroll={{ x: true }}
                />
              ),
            }}
            scroll={{ x: true }}
            locale={{ emptyText: <Empty description="Нет данных" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          />
        ) : (
          <Table
            rowKey={spec.rowKey}
            size="small"
            loading={spec.loading}
            columns={listColumns}
            dataSource={listed}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            scroll={{ x: true }}
            locale={{ emptyText: <Empty description="Нет данных" image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
          />
        )}
      </div>
    </Drawer>
  );
}

/** Thin horizontal meter with its figure on the right. */
function Meter({ value, text }: { value: number; text: ReactNode }) {
  return (
    <span className="drill-meter">
      <span className="drill-bar-track">
        <span className="drill-bar-fill" style={{ width: `${Math.min(100, value)}%` }} />
      </span>
      <span className="drill-bar-value">{text}</span>
    </span>
  );
}

function BreakdownBars<T>({
  breakdown,
  items,
  spec,
  selected,
  onPick,
}: {
  breakdown: Breakdown<T>;
  items: Tally[];
  spec: DrillSpec<T>;
  selected: string | undefined;
  onPick: (label: string) => void;
}) {
  const mode = modeOf(breakdown, spec);
  const size = (t: Tally) => (mode === "share" ? t.value : t.base);
  const shown = items.filter((t) => size(t) > 0);
  if (breakdown.order) {
    shown.sort((a, b) => breakdown.order!.indexOf(a.label) - breakdown.order!.indexOf(b.label));
  } else {
    shown.sort((a, b) => size(b) - size(a));
  }
  const max = Math.max(1, ...shown.map(size));
  const sum = shown.reduce((n, t) => n + size(t), 0);
  const unit =
    mode === "rate"
      ? lower(spec.rateTitle ?? "Доля")
      : lower(mode === "share" ? spec.countTitle : (spec.baseTitle ?? ""));

  return (
    <section className="drill-breakdown">
      <div className="drill-breakdown-head">
        <span>{breakdown.title}</span>
        <span className="meta">{unit}</span>
      </div>
      <div className="drill-bars">
        {shown.length === 0 && <span className="meta">нет данных</span>}
        {shown.map((t) => {
          const width = mode === "rate" ? pct(t.value, t.base) : (size(t) / max) * 100;
          const text =
            mode === "rate" ? `${pct(t.value, t.base)}% · ${num(t.value)}` : `${num(size(t))} · ${pct(size(t), sum)}%`;
          return (
            <button
              type="button"
              key={t.label}
              title={mode === "rate" ? `${t.label}: ${num(t.value)} из ${num(t.base)}` : t.label}
              className={`drill-bar${selected === t.label ? " is-active" : ""}`}
              onClick={() => onPick(t.label)}
            >
              <span className="drill-bar-label">{t.label}</span>
              <span className="drill-bar-track">
                <span className="drill-bar-fill" style={{ width: `${width}%` }} />
              </span>
              <span className="drill-bar-value">{text}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
