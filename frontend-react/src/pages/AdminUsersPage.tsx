import { DeleteOutlined, EditOutlined, KeyOutlined, PlusOutlined } from "@ant-design/icons";
import {
  App,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useGroups } from "../api/queries";
import type { Grant, HelpAccountScope, Role, UserAccount } from "../api/types";

/** Row of the grant editor inside the user dialog. */
interface GrantRow extends Grant {
  key: string;
}

const rowKey = (g: Grant) => `${g.scopeType}:${g.scopeValue}`;

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: "user", label: "Пользователь" },
  { value: "manager", label: "Руководитель" },
  { value: "admin", label: "Администратор" },
];

const ROLE_TAGS: Record<Role, { color?: string; label: string }> = {
  admin: { color: "blue", label: "администратор" },
  manager: { label: "руководитель" },
  user: { label: "пользователь" },
};

export default function AdminUsersPage() {
  const { message } = App.useApp();
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [helpAccounts, setHelpAccounts] = useState<HelpAccountScope[]>([]);
  const [loading, setLoading] = useState(false);
  const { data: groups = [] } = useGroups();

  const [editing, setEditing] = useState<UserAccount | null>(null);
  const [creating, setCreating] = useState(false);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [passwordFor, setPasswordFor] = useState<UserAccount | null>(null);
  const [form] = Form.useForm();
  const [passwordForm] = Form.useForm();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [list, accounts] = await Promise.all([api.listUsers(), api.listGrantableHelpAccounts()]);
      setUsers(list);
      setHelpAccounts(accounts);
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Не удалось загрузить пользователей");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openDialog = (user: UserAccount | null) => {
    setCreating(user === null);
    setEditing(user);
    setGrants((user?.grants ?? []).map((g) => ({ ...g, key: rowKey(g) })));
    form.setFieldsValue({
      username: user?.username ?? "",
      fullName: user?.fullName ?? "",
      role: user?.role ?? "manager",
      enabled: user?.enabled ?? true,
      password: "",
    });
  };

  const closeDialog = () => {
    setEditing(null);
    setCreating(false);
    setGrants([]);
  };

  const addGrants = (scopeType: Grant["scopeType"], values: string[]) => {
    setGrants((prev) => {
      const existing = new Set(prev.map((g) => g.key));
      const added = values
        .map((v) => ({ scopeType, scopeValue: v, canMetrics: true, canChats: false, key: `${scopeType}:${v}` }))
        .filter((g) => !existing.has(g.key));
      return [...prev, ...added];
    });
  };

  const save = async () => {
    const values = await form.validateFields();
    const payload = {
      fullName: values.fullName || null,
      role: values.role,
      enabled: values.enabled,
      grants: grants.map(({ key, ...g }) => g),
    };
    try {
      if (creating) {
        await api.createUser({ username: values.username.trim(), password: values.password, ...payload });
        message.success("Пользователь создан");
      } else if (editing) {
        await api.updateUser(editing.id, payload);
        message.success("Изменения сохранены");
      }
      closeDialog();
      await reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Не удалось сохранить");
    }
  };

  const savePassword = async () => {
    const values = await passwordForm.validateFields();
    if (!passwordFor) return;
    try {
      await api.setUserPassword(passwordFor.id, values.password);
      message.success("Пароль изменён");
      setPasswordFor(null);
      passwordForm.resetFields();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Не удалось изменить пароль");
    }
  };

  const remove = async (user: UserAccount) => {
    try {
      await api.deleteUser(user.id);
      message.success("Пользователь удалён");
      await reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Не удалось удалить");
    }
  };

  const columns: ColumnsType<UserAccount> = useMemo(
    () => [
      { title: "Логин", dataIndex: "username", sorter: (a, b) => a.username.localeCompare(b.username) },
      { title: "ФИО", dataIndex: "fullName" },
      {
        title: "Роль",
        dataIndex: "role",
        render: (role: Role) => <Tag color={ROLE_TAGS[role].color}>{ROLE_TAGS[role].label}</Tag>,
      },
      {
        title: "Доступ",
        key: "grants",
        render: (_, u) =>
          u.role === "admin" ? (
            <Tag color="blue">все группы</Tag>
          ) : u.grants.length === 0 ? (
            <Tag color="red">не выдан</Tag>
          ) : (
            <Space size={[4, 4]} wrap>
              {u.grants.map((g) => (
                <Tag key={rowKey(g)} color={g.scopeType === "help_account" ? "geekblue" : "default"}>
                  {g.scopeValue}
                  {/* The same flag means less for a read-only account: the two
                      statistics tables rather than the metrics dashboard. */}
                  {g.canMetrics ? (u.role === "user" ? " · статистика" : " · метрики") : ""}
                  {g.canChats ? " · чаты" : ""}
                </Tag>
              ))}
            </Space>
          ),
      },
      {
        title: "Активен",
        dataIndex: "enabled",
        render: (v: boolean) => (v ? <Tag color="green">да</Tag> : <Tag color="red">нет</Tag>),
      },
      {
        title: "Создан",
        dataIndex: "createdAt",
        render: (v: string) => dayjs(v).format("DD.MM.YYYY"),
      },
      {
        title: "",
        key: "actions",
        render: (_, u) => (
          <Space>
            <Tooltip title="Изменить">
              <Button icon={<EditOutlined />} size="small" onClick={() => openDialog(u)} />
            </Tooltip>
            <Tooltip title="Сменить пароль">
              <Button icon={<KeyOutlined />} size="small" onClick={() => setPasswordFor(u)} />
            </Tooltip>
            <Popconfirm
              title={`Удалить ${u.username}?`}
              okText="Удалить"
              cancelText="Отмена"
              onConfirm={() => remove(u)}
            >
              <Tooltip title="Удалить">
                <Button icon={<DeleteOutlined />} size="small" danger />
              </Tooltip>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const role: Role = Form.useWatch("role", form) ?? "manager";
  const isAdminRole = role === "admin";
  const isReadOnlyRole = role === "user";

  const grantColumns: ColumnsType<GrantRow> = [
    {
      title: "Область",
      dataIndex: "scopeValue",
      render: (v: string, g) => (
        <Space>
          <Tag color={g.scopeType === "help_account" ? "geekblue" : "default"}>
            {g.scopeType === "help_account" ? "участок" : "группа"}
          </Tag>
          {v}
          {g.scopeType === "help_account" && (
            <Tooltip title={helpAccounts.find((a) => a.account === v)?.groups.join(", ")}>
              <span className="meta">
                {helpAccounts.find((a) => a.account === v)?.groups.length ?? 0} гр.
              </span>
            </Tooltip>
          )}
        </Space>
      ),
    },
    {
      // For a read-only account the same flag opens the two statistics tables,
      // not the metrics dashboard - so it is labelled for what it actually does.
      title: isReadOnlyRole ? "Статистика" : "Метрики",
      dataIndex: "canMetrics",
      width: 110,
      render: (v: boolean, g) => (
        <Checkbox
          checked={v}
          onChange={(e) =>
            setGrants((prev) =>
              prev.map((x) => (x.key === g.key ? { ...x, canMetrics: e.target.checked } : x)),
            )
          }
        />
      ),
    },
    // A read-only account never reads correspondence, so the column is gone
    // rather than shown disabled - there is nothing to decide.
    ...(isReadOnlyRole
      ? []
      : [
          {
            title: "Чаты",
            dataIndex: "canChats",
            width: 90,
            render: (v: boolean, g: GrantRow) => (
              <Checkbox
                checked={v}
                onChange={(e) =>
                  setGrants((prev) =>
                    prev.map((x) => (x.key === g.key ? { ...x, canChats: e.target.checked } : x)),
                  )
                }
              />
            ),
          },
        ]),
    {
      title: "",
      key: "remove",
      width: 50,
      render: (_, g) => (
        <Button
          icon={<DeleteOutlined />}
          size="small"
          danger
          onClick={() => setGrants((prev) => prev.filter((x) => x.key !== g.key))}
        />
      ),
    },
  ];

  return (
    <Card>
      <div className="table-toolbar">
        <span className="meta">{users.length} учётных записей</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => openDialog(null)}>
          Добавить
        </Button>
      </div>
      <Table rowKey="id" columns={columns} dataSource={users} loading={loading} pagination={false} />

      <Modal
        title={creating ? "Новый пользователь" : `Пользователь ${editing?.username ?? ""}`}
        open={creating || editing !== null}
        onCancel={closeDialog}
        onOk={save}
        okText="Сохранить"
        cancelText="Отмена"
        width={760}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Space align="start" wrap>
            {creating && (
              <>
                <Form.Item
                  name="username"
                  label="Логин"
                  rules={[{ required: true, message: "Введите логин" }]}
                >
                  <Input style={{ width: 180 }} autoComplete="off" />
                </Form.Item>
                <Form.Item
                  name="password"
                  label="Пароль"
                  rules={[{ required: true, min: 8, message: "Минимум 8 символов" }]}
                >
                  <Input.Password style={{ width: 200 }} autoComplete="new-password" />
                </Form.Item>
              </>
            )}
            <Form.Item name="fullName" label="ФИО">
              <Input style={{ width: 220 }} />
            </Form.Item>
            <Form.Item name="role" label="Роль">
              <Select
                style={{ width: 180 }}
                options={ROLE_OPTIONS}
                // Demoting to read-only drops the chat flags right away, so the
                // dialog shows what will actually be saved.
                onChange={(v: Role) =>
                  v === "user" && setGrants((prev) => prev.map((g) => ({ ...g, canChats: false })))
                }
              />
            </Form.Item>
            <Form.Item name="enabled" label="Активен" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
        </Form>

        {isAdminRole ? (
          <Tag color="blue" style={{ marginTop: 8 }}>
            Администратор видит все группы, доступы указывать не нужно
          </Tag>
        ) : (
          <>
            <Space style={{ marginBottom: 12 }} wrap>
              <Select
                mode="multiple"
                allowClear
                placeholder="Добавить участки (help-аккаунты)"
                style={{ width: 320 }}
                value={[]}
                options={helpAccounts.map((a) => ({
                  value: a.account,
                  // Show what the grant actually covers - it is derived from the
                  // correspondence, not configured by hand.
                  label: `${a.account} · ${a.groups.length} гр.`,
                  title: a.groups.join(", "),
                }))}
                onChange={(v) => addGrants("help_account", v)}
              />
              <Select
                mode="multiple"
                allowClear
                showSearch
                placeholder="Добавить отдельные группы"
                style={{ width: 320 }}
                value={[]}
                options={groups.map((g) => ({ value: g.groupName, label: g.groupName }))}
                onChange={(v) => addGrants("group", v)}
              />
            </Space>
            <Table
              rowKey="key"
              columns={grantColumns}
              dataSource={grants}
              size="small"
              pagination={false}
              locale={{ emptyText: "Доступы не выданы: пользователь не увидит ничего" }}
            />
          </>
        )}
      </Modal>

      <Modal
        title={`Смена пароля: ${passwordFor?.username ?? ""}`}
        open={passwordFor !== null}
        onCancel={() => setPasswordFor(null)}
        onOk={savePassword}
        okText="Сохранить"
        cancelText="Отмена"
        destroyOnHidden
      >
        <Form form={passwordForm} layout="vertical">
          <Form.Item
            name="password"
            label="Новый пароль"
            rules={[{ required: true, min: 8, message: "Минимум 8 символов" }]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
