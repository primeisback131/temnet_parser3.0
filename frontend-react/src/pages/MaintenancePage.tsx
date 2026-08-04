import { DatabaseOutlined, ReloadOutlined, SyncOutlined, WarningOutlined } from "@ant-design/icons";
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
  Typography,
} from "antd";
import dayjs from "dayjs";
import { useEffect, useRef, useState } from "react";
import { api, ConflictError } from "../api/client";
import { useSyncStatus } from "../api/queries";
import type { SyncRun } from "../api/types";

/** Typing this word is what arms the rebuild button — it is not undoable. */
const CONFIRM_WORD = "ПЕРЕСОБРАТЬ";

const KIND_LABEL: Record<SyncRun["kind"], string> = {
  scheduled: "по расписанию",
  incremental: "инкрементальная синхронизация",
  rebuild: "полная пересборка",
};

function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} с`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} мин ${String(seconds % 60).padStart(2, "0")} с`;
}

const num = (n: number) => n.toLocaleString("ru-RU");

export default function MaintenancePage() {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const { data: status, isLoading, refetch } = useSyncStatus();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmWord, setConfirmWord] = useState("");
  const [starting, setStarting] = useState(false);

  const run = status?.run ?? null;
  const running = run?.running ?? false;

  // A run publishes no progress, only a start time, so tick the clock
  // ourselves — the 2-second poll returns an unchanged object and would not
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
      message.error(
        e instanceof ConflictError
          ? e.message
          : e instanceof Error
            ? e.message
            : "Не удалось запустить",
      );
      await refetch();
    } finally {
      setStarting(false);
    }
  };

  const elapsed = run ? formatDuration(now - dayjs(run.startedAt).valueOf()) : "";

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
        <Descriptions column={{ xs: 1, sm: 2, lg: 3 }} size="small">
          <Descriptions.Item label="Последняя синхронизация">
            {status?.last_run_at ? dayjs(status.last_run_at).format("DD.MM.YYYY HH:mm:ss") : "—"}
          </Descriptions.Item>
          <Descriptions.Item label="Сообщений в базе">
            {status ? num(status.messages_total) : "—"}
          </Descriptions.Item>
          <Descriptions.Item label="Позиция в дампе">
            {status ? num(status.last_archive_id) : "—"}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {run?.running && (
        <Alert
          type="warning"
          showIcon
          icon={<Spin size="small" />}
          message={`Идёт ${KIND_LABEL[run.kind]} — ${elapsed}`}
          description={
            <>
              Запустил: {run.startedBy}. Идет пересборка. Страницу можно закрыть.
            </>
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
              Просмотрено строк дампа: {num(run.summary.scannedRows)}; новых сообщений:{" "}
              {num(run.summary.newMessages)}; классифицировано LLM: {num(run.summary.llmClassified)}.
              Завершено {dayjs(run.finishedAt).format("DD.MM.YYYY HH:mm:ss")}, запускал{" "}
              {run.startedBy}.
            </>
          }
        />
      )}

      <Card title="Обслуживание">
        <Space direction="vertical" size="middle" style={{ width: "100%" }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
            Синхронизация идёт сама каждые 5 минут и забирает из дампа только новые сообщения.
            Запускать вручную нужно только сразу после того, как залит свежий дамп.
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
          </Space>

          <Alert
            type="info"
            showIcon
            message="Когда нужна полная пересборка"
            description={
              <>
                Только когда изменились правила разбора: категории, правила классификации заявок, окна
                истечения и повторных обращений. Пересборка перечитывает весь дамп заново и
                применяет к нему текущий код - без неё старые заявки останутся посчитанными по
                старым правилам.
              </>
            }
          />
        </Space>
      </Card>

      <Modal
        title={
          <Space>
            <WarningOutlined style={{ color: "#cf1322" }} />
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
                <li>таблицы сообщений и заявок очищаются полностью;</li>
                <li>весь дамп читается заново - это занимает несколько минут;</li>
                <li>
                  пока идёт пересборка, метрики и чаты показывают неполные данные;
                </li>           
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
