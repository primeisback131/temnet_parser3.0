import { DatabaseOutlined, ReloadOutlined, SyncOutlined, UnlockOutlined, WarningOutlined } from "@ant-design/icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Input,
  Modal,
  Space,
  Spin,
  Tooltip,
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useEffect, useRef, useState } from "react";
import { api } from "../api/client";
import { useSyncStatus } from "../api/queries";
import type { SyncRun } from "../api/types";
import QueryError from "../components/QueryError";

/** Typing this word is what arms the rebuild button - it is not undoable. */
const CONFIRM_WORD = "ПЕРЕСОБРАТЬ";

const KIND_LABEL: Record<SyncRun["kind"], string> = {
  scheduled: "синхронизация по расписанию",
  incremental: "инкрементальная синхронизация",
  rebuild: "полная пересборка",
};

function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} мин ${String(seconds % 60).padStart(2, "0")} с`;
}

/** "каждые 5 минут" / "каждые 30 секунд" / "каждый час", from the configured interval. */
function formatInterval(seconds: number): string {
  if (seconds % 3600 === 0) {
    const h = seconds / 3600;
    return h === 1 ? "каждый час" : `каждые ${h} ч`;
  }
  if (seconds % 60 === 0) return `каждые ${seconds / 60} мин`;
  return `каждые ${seconds} с`;
}

const num = (n: number) => n.toLocaleString("ru-RU");

export default function MaintenancePage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { data: status, isLoading, error, refetch } = useSyncStatus();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmWord, setConfirmWord] = useState("");
  const [starting, setStarting] = useState(false);

  const run = status?.run ?? null;
  const running = run?.running ?? false;

  // A run publishes no progress, only a start time, so tick the clock
  // ourselves - the 2-second poll returns an unchanged object and would not
  // re-render on its own.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);

  // Every metric answer on screen was computed from the data that just got
  // rewritten, so drop the whole cache the moment a run finishes.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && !running) {
      void queryClient.invalidateQueries();
    }
    wasRunning.current = running;
  }, [running, queryClient]);

  const start = async (rebuild: boolean) => {
    setStarting(true);
    try {
      await (rebuild ? api.startRebuild() : api.startSync());
      setConfirmOpen(false);
      setConfirmWord("");
      message.info(rebuild ? "Пересборка запущена" : "Синхронизация запущена");
      await refetch();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Не удалось запустить");
      await refetch();
    } finally {
      setStarting(false);
    }
  };

  const unlock = async () => {
    try {
      await api.clearLockouts();
      message.success("Блокировки входа сняты");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Не удалось снять блокировки");
    }
  };

  const elapsed = run ? formatDuration(now - dayjs(run.startedAt).valueOf()) : "";
  const interval = status ? formatInterval(status.syncIntervalSeconds) : "по расписанию";

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Card
        title={
          <Space>
            <DatabaseOutlined />
            Состояние базы аналитики
          </Space>
        }
        extra={
          <Button icon={<ReloadOutlined />} size="small" onClick={() => void refetch()}>
            Обновить
          </Button>
        }
        loading={isLoading}
      >
        <QueryError error={error} />
        <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} size="small">
          <Descriptions.Item label="Последняя синхронизация">
            {status?.last_run_at ? dayjs(status.last_run_at).format("DD.MM.YYYY HH:mm:ss") : "-"}
          </Descriptions.Item>
          <Descriptions.Item label="Сообщений в базе">
            {status ? num(status.messages_total) : "-"}
          </Descriptions.Item>
          <Descriptions.Item label="Позиция в дампе">
            {status ? num(status.last_archive_id) : "-"}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {run?.running && (
        <Alert
          type="warning"
          showIcon
          icon={<Spin size="small" />}
          message={`Идёт ${KIND_LABEL[run.kind]}, ${elapsed}`}
          description={
            run.kind === "rebuild"
              ? `Запустил ${run.startedBy}. Данные собираются заново в теневых таблицах, до конца пересборки метрики и чаты показывают прежние данные. Страницу можно закрыть.`
              : `Запустил ${run.startedBy}. Из дампа забираются новые сообщения. Страницу можно закрыть.`
          }
        />
      )}

      {!running && run?.error && (
        <Alert
          type="error"
          showIcon
          message={`Последний запуск (${KIND_LABEL[run.kind]}) завершился с ошибкой`}
          description={run.error}
        />
      )}

      {!running && run?.summary && (
        <Alert
          type="success"
          showIcon
          message={`${KIND_LABEL[run.kind]} завершена за ${formatDuration(run.summary.durationMs)}`}
          description={
            <>
              Строк дампа: {num(run.summary.scannedRows)}, новых сообщений:{" "}
              {num(run.summary.newMessages)}, классифицировано LLM: {num(run.summary.llmClassified)}.
              Завершено {dayjs(run.finishedAt).format("DD.MM.YYYY HH:mm:ss")}, запускал {run.startedBy}.
            </>
          }
        />
      )}

      <Card title="Обслуживание">
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Синхронизация идёт сама {interval} и забирает только новые сообщения. Вручную -
            сразу после того, как залит свежий дамп.
          </Typography.Paragraph>
          <Space wrap>
            <Button
              icon={<SyncOutlined />}
              loading={starting && !confirmOpen}
              disabled={running}
              onClick={() => void start(false)}
            >
              Синхронизировать
            </Button>
            <Button danger icon={<WarningOutlined />} disabled={running} onClick={() => setConfirmOpen(true)}>
              Пересобрать базу
            </Button>
            <Tooltip title="Сбрасывает счётчики неудачных попыток входа по всем логинам и адресам">
              <Button icon={<UnlockOutlined />} onClick={() => void unlock()}>
                Снять блокировки входа
              </Button>
            </Tooltip>
          </Space>

          <Alert
            type="info"
            showIcon
            message="Когда нужна полная пересборка"
            description="Только если изменились правила разбора: категории, классификация заявок, окна истечения и повторных обращений, часовые пояса. Пересборка перечитывает дамп заново и применяет текущий код; без неё старые заявки останутся посчитанными по старым правилам."
          />
        </Space>
      </Card>

      <Modal
        title={
          <Space>
            <WarningOutlined style={{ color: "var(--danger)" }} />
            Полная пересборка базы аналитики
          </Space>
        }
        open={confirmOpen}
        onCancel={() => {
          setConfirmOpen(false);
          setConfirmWord("");
        }}
        onOk={() => void start(true)}
        okText="Пересобрать"
        cancelText="Отмена"
        okButtonProps={{
          danger: true,
          disabled: confirmWord.trim().toUpperCase() !== CONFIRM_WORD,
          loading: starting,
        }}
        destroyOnHidden
      >
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Alert
            type="error"
            showIcon
            message="Действие необратимо"
            description={
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                <li>весь дамп читается заново, это занимает несколько минут;</li>
                <li>
                  заявки и сообщения собираются в теневых таблицах и подменяют текущие одним махом, до
                  этого момента метрики показывают прежние данные;
                </li>
                <li>вердикты LLM сохраняются, повторно они не запрашиваются.</li>
              </ul>
            }
          />
          <div>
            <Typography.Text>
              Чтобы подтвердить, введите <Typography.Text strong>{CONFIRM_WORD}</Typography.Text>:
            </Typography.Text>
            <Input
              value={confirmWord}
              onChange={(e) => setConfirmWord(e.target.value)}
              placeholder={CONFIRM_WORD}
              style={{ marginTop: 8 }}
              autoFocus
            />
          </div>
        </Space>
      </Modal>
    </Space>
  );
}
