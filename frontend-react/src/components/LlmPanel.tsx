import { PlayCircleOutlined, ReloadOutlined, RobotOutlined, SaveOutlined, UndoOutlined } from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useState } from "react";
import { api } from "../api/client";
import { useLlmStatus } from "../api/queries";
import type { LlmSettings, LlmStatus, LlmStep } from "../api/types";
import QueryError from "./QueryError";

const num = (n: number) => n.toLocaleString("ru-RU");
const pct = (fraction: number) => `${Math.round(fraction * 100)}%`;

/** "2 ч 10 мин" / "35 мин" from a number of minutes. */
function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} ч` : `${h} ч ${rest} мин`;
}

/** "3 дн 4 ч" / "5 ч" / "40 мин" from hours. */
function formatHours(hours: number): string {
  if (hours < 1) return formatMinutes(hours * 60);
  if (hours < 48) return formatMinutes(hours * 60);
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours - days * 24);
  return rest === 0 ? `${days} дн` : `${days} дн ${rest} ч`;
}

const CATEGORY_MODES: { value: LlmSettings["categories"]; label: string }[] = [
  { value: "other", label: "только заявки из «Другое»" },
  { value: "all", label: "все завершённые заявки, модель важнее словаря" },
  { value: "off", label: "не классифицировать" },
];

/** What the form edits: percentages instead of fractions for the ceilings. */
interface FormValues {
  categories: LlmSettings["categories"];
  maxPerSync: number;
  requestsPerMinute: number;
  ceilingIdlePct: number;
  ceilingBusyPct: number;
  busyWindowMinutes: number;
  model: string;
}

function toForm(s: LlmSettings): FormValues {
  return {
    categories: s.categories,
    maxPerSync: s.maxPerSync,
    requestsPerMinute: s.requestsPerMinute,
    ceilingIdlePct: Math.round(s.ceilingIdle * 100),
    ceilingBusyPct: Math.round(s.ceilingBusy * 100),
    busyWindowMinutes: s.busyWindowMinutes,
    model: s.model,
  };
}

function fromForm(v: FormValues, enabled: boolean): LlmSettings {
  return {
    enabled,
    categories: v.categories,
    maxPerSync: v.maxPerSync,
    requestsPerMinute: v.requestsPerMinute,
    ceilingIdle: v.ceilingIdlePct / 100,
    ceilingBusy: v.ceilingBusyPct / 100,
    busyWindowMinutes: v.busyWindowMinutes,
    model: v.model,
  };
}

/** One classifier's last run, as a line of text plus a tag for how it ended. */
function StepLine({ label, step }: { label: string; step: LlmStep | null }) {
  if (!step) {
    return (
      <Typography.Text type="secondary">
        {label}: ещё не запускался
      </Typography.Text>
    );
  }
  return (
    <Space wrap size={4}>
      <Typography.Text>
        {label}: {dayjs(step.at).format("HH:mm:ss")}, вызовов {num(step.calls)}, решено {num(step.decided)}
      </Typography.Text>
      {step.pausedReason && <Tag color="warning">пауза: {step.pausedReason}</Tag>}
      {step.error && <Tag color="error">ошибка: {step.error}</Tag>}
    </Space>
  );
}

/** The subscription window, for the Claude CLI provider. */
function UsageBlock({ status }: { status: LlmStatus }) {
  const t = status.telemetry;
  const utilization = t.fiveHourUtilization ?? null;
  const ceiling = t.ceilingNow ?? status.settings.ceilingIdle;
  const busy = t.ownerBusy ?? false;

  if (utilization === null) {
    return (
      <Typography.Text type="secondary">
        Загрузка 5-часового окна подписки станет известна после первого вызова модели. Потолок сейчас{" "}
        {pct(ceiling)} ({busy ? "вы работаете с Claude Code" : "вы не работаете с Claude Code"}).
      </Typography.Text>
    );
  }

  const tone =
    utilization >= ceiling ? "var(--danger)" : utilization >= ceiling * 0.8 ? "var(--warning)" : "var(--success)";
  const resetsIn = t.fiveHourResetsAt ? formatMinutes((t.fiveHourResetsAt - Date.now()) / 60000) : null;
  return (
    <Space direction="vertical" size={4} style={{ width: "100%" }}>
      <Progress
        percent={Math.round(utilization * 100)}
        strokeColor={tone}
        size={["100%", 10]}
        format={(p) => `${p}%`}
      />
      <Typography.Text type="secondary">
        Окно 5 часов: {pct(utilization)}, потолок сейчас {pct(ceiling)} (
        {busy ? "вы работаете с Claude Code" : "вы не работаете с Claude Code"})
        {resetsIn ? `, сброс через ${resetsIn}` : ""}
        {t.sevenDayUtilization != null ? `. Окно 7 дней: ${pct(t.sevenDayUtilization)}` : ""}
        {t.readingAt ? `. Замер ${dayjs(t.readingAt).format("HH:mm:ss")}` : ""}
      </Typography.Text>
    </Space>
  );
}

export default function LlmPanel() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { data: status, isLoading, error, refetch } = useLlmStatus();
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);

  const running = status?.run?.running ?? false;
  const configured = status?.provider.configured ?? false;
  const enabled = status?.settings.enabled ?? false;
  const isCli = status?.provider.kind === "claude-cli";

  const refreshAll = async () => {
    await Promise.all([refetch(), queryClient.invalidateQueries({ queryKey: ["syncStatus"] })]);
  };

  const save = async (next: LlmSettings, done: string) => {
    setSaving(true);
    try {
      await api.updateLlmSettings(next);
      message.success(done);
      await refetch();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Не удалось сохранить");
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setSaving(true);
    try {
      await api.resetLlmSettings();
      message.success("Настройки сброшены к значениям окружения");
      await refetch();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Не удалось сбросить");
    } finally {
      setSaving(false);
    }
  };

  const startRun = async () => {
    setStarting(true);
    try {
      await api.startLlmRun();
      message.info("Классификация запущена");
      await refreshAll();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Не удалось запустить");
      await refreshAll();
    } finally {
      setStarting(false);
    }
  };

  // The form remounts only when the saved settings change (its key), so a
  // background poll never overwrites what the admin is typing.
  const settingsKey = status ? JSON.stringify(status.settings) : "none";

  const stateTag = (() => {
    if (!status) return null;
    if (!configured) return <Tag>провайдер не настроен</Tag>;
    if (!enabled) return <Tag>выключена</Tag>;
    const paused = status.telemetry.pausedReason;
    if (paused) return <Tag color="warning">пауза: {paused}</Tag>;
    if (isCli && status.telemetry.loggedIn === false) {
      return <Tag color="error">{status.telemetry.authError ?? "нет входа в Claude Code"}</Tag>;
    }
    return <Tag color="success">работает</Tag>;
  })();

  const counters = status?.counters;
  const pendingTotal = counters ? counters.reopens.pending + counters.categories.pending : 0;
  const eta =
    status && enabled && configured && status.settings.maxPerSync > 0 && pendingTotal > 0
      ? formatHours((pendingTotal / status.settings.maxPerSync) * (status.syncIntervalSeconds / 3600))
      : null;

  return (
    <Card
      title={
        <Space>
          <RobotOutlined />
          LLM-классификация
          {stateTag}
        </Space>
      }
      extra={
        <Space>
          <Tooltip title={configured ? "Пауза и запуск классификаторов" : "Провайдер не настроен"}>
            <Switch
              checked={enabled}
              disabled={!configured || saving}
              checkedChildren="вкл"
              unCheckedChildren="выкл"
              onChange={(on) =>
                status && void save({ ...status.settings, enabled: on }, on ? "Классификация включена" : "Классификация на паузе")
              }
            />
          </Tooltip>
          <Button icon={<ReloadOutlined />} size="small" onClick={() => void refetch()}>
            Обновить
          </Button>
        </Space>
      }
      loading={isLoading}
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <QueryError error={error} />

        {status && !configured && (
          <Alert
            type="info"
            showIcon
            message="Провайдер модели не настроен"
            description="Задайте LLM_PROVIDER=claude-cli (Claude Code CLI на подписке этой машины) или LLM_PROVIDER=http вместе с LLM_BASE_URL и перезапустите бэкенд. Счётчики ниже показывают, сколько данных ждёт классификации."
          />
        )}

        {status?.telemetry.overageSeen && (
          <Alert
            type="error"
            showIcon
            message="Claude Code использует платные usage credits"
            description="Вызовы остановлены, чтобы подписка не переходила в платный перерасход. Отключите overage в настройках claude.ai или примите расходы и перезапустите бэкенд."
          />
        )}

        {status && (
          <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} size="small">
            <Descriptions.Item label="Провайдер">{status.provider.description}</Descriptions.Item>
            {isCli && (
              <Descriptions.Item label="Вход Claude Code">
                {status.telemetry.loggedIn
                  ? `${status.telemetry.authMethod ?? "?"}, подписка ${status.telemetry.subscription ?? "-"}`
                  : status.telemetry.authError ?? "не проверялся"}
              </Descriptions.Item>
            )}
            {!isCli && status.provider.kind === "http" && (
              <Descriptions.Item label="Ключ API">
                {status.telemetry.hasApiKey ? "задан" : "не задан"}
              </Descriptions.Item>
            )}
            <Descriptions.Item label="Последний прогон">
              {status.stats.lastRunAt ? dayjs(status.stats.lastRunAt).format("DD.MM.YYYY HH:mm:ss") : "-"}
            </Descriptions.Item>
            <Descriptions.Item label="Вызовов с запуска бэкенда">
              {num(status.stats.totalCalls)}
              {status.stats.averageCallMillis != null
                ? `, в среднем ${(status.stats.averageCallMillis / 1000).toFixed(1)} с`
                : ""}
            </Descriptions.Item>
            <Descriptions.Item label="Решено с запуска бэкенда">
              повторов {num(status.stats.totalReopensDecided)}, категорий {num(status.stats.totalCategoriesDecided)}
            </Descriptions.Item>
            {eta && (
              <Descriptions.Item label="Очередь при текущем лимите">
                около {eta}, без учёта потолков окна
              </Descriptions.Item>
            )}
          </Descriptions>
        )}

        {status && isCli && configured && <UsageBlock status={status} />}

        {counters && (
          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <Card size="small" title="Повторные обращения">
                <Row gutter={[16, 8]}>
                  <Col span={8}>
                    <Statistic title="Ждут вердикта" value={counters.reopens.pending} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="Модель: та же проблема" value={counters.reopens.same} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="Модель: новая проблема" value={counters.reopens.new} />
                  </Col>
                </Row>
                <Typography.Text type="secondary">
                  Ещё {num(counters.reopens.heuristic)} повторов распознаны по маркерным словам и категории без модели.
                </Typography.Text>
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card size="small" title="Категории">
                <Row gutter={[16, 8]}>
                  <Col span={8}>
                    <Statistic title="Ждут классификации" value={counters.categories.pending} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="Классифицировано моделью" value={counters.categories.classified} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="Открытых в «Другое»" value={counters.categories.openOther} />
                  </Col>
                </Row>
                <Typography.Text type="secondary">
                  В «Другое» сейчас {num(counters.categories.otherTotal)} из {num(counters.categories.ticketsTotal)}{" "}
                  заявок. Открытые заявки ждут завершения: их категорию ещё уточняет разбор сообщений.
                </Typography.Text>
              </Card>
            </Col>
          </Row>
        )}

        {status && (
          <Space direction="vertical" size={2}>
            <StepLine label="Повторы" step={status.stats.reopens} />
            <StepLine label="Категории" step={status.stats.categories} />
          </Space>
        )}

        {counters && counters.categories.byCategory.length > 0 && (
          <Table
            size="small"
            pagination={false}
            rowKey="category"
            dataSource={counters.categories.byCategory}
            columns={[
              { title: "Категория от модели", dataIndex: "category" },
              {
                title: "Заявок",
                dataIndex: "count",
                align: "right" as const,
                width: 120,
                render: (v: number) => num(v),
              },
            ]}
            scroll={{ x: true }}
          />
        )}

        <Space wrap>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={starting}
            disabled={running || !enabled || !configured}
            onClick={() => void startRun()}
          >
            Классифицировать сейчас
          </Button>
          <Typography.Text type="secondary">
            Один прогон классификаторов без чтения дампа, в пределах лимита вызовов ниже.
          </Typography.Text>
        </Space>

        {status && (
          <Form<FormValues>
            key={settingsKey}
            form={form}
            layout="vertical"
            initialValues={toForm(status.settings)}
            onFinish={(v) => void save(fromForm(v, enabled), "Настройки сохранены")}
          >
            <Typography.Title level={5} style={{ marginTop: 8 }}>
              Настройки
            </Typography.Title>
            <Typography.Paragraph type="secondary">
              Хранятся в базе и переопределяют переменные окружения, применяются со следующего прогона.
              {status.overriddenKeys.length > 0
                ? ` Отличаются от окружения: ${status.overriddenKeys.join(", ")}.`
                : " Сейчас действуют значения окружения."}
            </Typography.Paragraph>
            <Row gutter={16}>
              <Col xs={24} md={12} lg={8}>
                <Form.Item name="categories" label="Какие заявки получают категорию от модели">
                  <Select options={CATEGORY_MODES} />
                </Form.Item>
              </Col>
              <Col xs={24} md={12} lg={8}>
                <Form.Item name="model" label="Модель" rules={[{ required: true, message: "Укажите модель" }]}>
                  <Input />
                </Form.Item>
              </Col>
              <Col xs={12} md={6} lg={4}>
                <Form.Item
                  name="maxPerSync"
                  label="Вызовов за прогон"
                  extra={`по умолчанию ${status.defaults.maxPerSync}`}
                  rules={[{ required: true, message: "Обязательно" }]}
                >
                  <InputNumber min={0} max={5000} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col xs={12} md={6} lg={4}>
                <Form.Item
                  name="requestsPerMinute"
                  label="Вызовов в минуту"
                  extra="0 = без ограничения"
                  rules={[{ required: true, message: "Обязательно" }]}
                >
                  <InputNumber min={0} max={600} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              {isCli && (
                <>
                  <Col xs={12} md={6} lg={4}>
                    <Form.Item
                      name="ceilingIdlePct"
                      label="Потолок окна, когда вы не работаете, %"
                      extra={`по умолчанию ${Math.round(status.defaults.ceilingIdle * 100)}`}
                      rules={[{ required: true, message: "Обязательно" }]}
                    >
                      <InputNumber min={1} max={100} style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={6} lg={4}>
                    <Form.Item
                      name="ceilingBusyPct"
                      label="Потолок окна, когда работаете, %"
                      extra={`по умолчанию ${Math.round(status.defaults.ceilingBusy * 100)}`}
                      rules={[{ required: true, message: "Обязательно" }]}
                    >
                      <InputNumber min={1} max={100} style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                  <Col xs={12} md={6} lg={4}>
                    <Form.Item
                      name="busyWindowMinutes"
                      label="Окно занятости, мин"
                      extra="0 = всегда считать, что вы не работаете"
                      rules={[{ required: true, message: "Обязательно" }]}
                    >
                      <InputNumber min={0} max={1440} style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                </>
              )}
            </Row>
            {isCli && (
              <Typography.Paragraph type="secondary">
                Потолки относятся к 5-часовому окну подписки Claude. Вы считаетесь работающим с Claude Code, если
                транскрипт какой-либо сессии менялся в пределах окна занятости.
              </Typography.Paragraph>
            )}
            <Space wrap>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={saving}>
                Сохранить
              </Button>
              <Popconfirm
                title="Сбросить к значениям окружения?"
                description="Сохранённые в базе значения будут удалены."
                okText="Сбросить"
                cancelText="Отмена"
                onConfirm={() => void reset()}
              >
                <Button icon={<UndoOutlined />} disabled={status.overrides && Object.keys(status.overrides).length === 0}>
                  Сбросить к настройкам окружения
                </Button>
              </Popconfirm>
            </Space>
          </Form>
        )}
      </Space>
    </Card>
  );
}
