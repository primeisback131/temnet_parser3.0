import {
  BankOutlined,
  CustomerServiceOutlined,
  DatabaseOutlined,
  KeyOutlined,
  LineChartOutlined,
  LogoutOutlined,
  MessageOutlined,
  MoonOutlined,
  SafetyOutlined,
  SunOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { App, Button, Layout, Menu, Modal, Tag, Tooltip } from "antd";
import type { MenuProps } from "antd";
import { useState, type ReactNode } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { useThemeMode } from "../theme";
import BrandMark from "./BrandMark";
import ChangePasswordForm from "./ChangePasswordForm";

const { Header, Sider, Content } = Layout;

type MenuItem = NonNullable<MenuProps["items"]>[number];

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, toggle } = useThemeMode();
  const { user, logout, canUseChats, canViewMetrics } = useAuth();
  const { message } = App.useApp();
  const [passwordOpen, setPasswordOpen] = useState(false);

  // The menu only offers what the backend would actually serve.
  const sections: { label: string; items: { key: string; icon: ReactNode; label: string }[] }[] = [
    {
      label: "Аналитика",
      items: [
        ...(canUseChats ? [{ key: "/chat", icon: <MessageOutlined />, label: "Чат" }] : []),
        ...(canViewMetrics ? [{ key: "/metrics", icon: <LineChartOutlined />, label: "Метрики" }] : []),
        ...(canViewMetrics
          ? [{ key: "/operators", icon: <CustomerServiceOutlined />, label: "Операторы" }]
          : []),
      ],
    },
    {
      label: "Статистика",
      items: [
        { key: "/companies", icon: <BankOutlined />, label: "Компании" },
        { key: "/users", icon: <TeamOutlined />, label: "Пользователи" },
      ],
    },
    ...(user?.role === "admin"
      ? [
          {
            label: "Администрирование",
            items: [
              { key: "/admin/users", icon: <SafetyOutlined />, label: "Учётные записи" },
              { key: "/admin/maintenance", icon: <DatabaseOutlined />, label: "Обслуживание" },
            ],
          },
        ]
      : []),
  ].filter((s) => s.items.length > 0);

  const flat = sections.flatMap((s) => s.items);

  // Longest key first: /users must not swallow /admin/users.
  const selected =
    [...flat].sort((a, b) => b.key.length - a.key.length).find((i) => location.pathname.startsWith(i.key))
      ?.key ?? flat[0]?.key;

  const menuItems: MenuItem[] = sections.map((section) => ({
    type: "group",
    key: section.label,
    label: section.label,
    children: section.items,
  }));

  const roleTag =
    user?.role === "admin" ? (
      <Tag color="blue" style={{ marginInlineEnd: 0 }}>
        админ
      </Tag>
    ) : user?.role === "user" ? (
      <Tag style={{ marginInlineEnd: 0 }}>просмотр</Tag>
    ) : null;

  return (
    <Layout className="app-shell">
      <Sider className="app-sider" width={228} breakpoint="lg" collapsedWidth="0" theme="light">
        <div className="app-brand">
          <span className="app-brand-mark">
            <BrandMark />
          </span>
          <span className="app-brand-text">
            <div className="app-brand-name">Temnet Parser</div>
            <div className="app-brand-sub">аналитика поддержки</div>
          </span>
        </div>
        <Menu
          className="app-nav"
          mode="inline"
          theme="light"
          selectedKeys={selected ? [selected] : []}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <span className="app-title">{flat.find((i) => i.key === selected)?.label}</span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="app-user">
              <span className="app-user-name">{user?.fullName || user?.username}</span>
              {roleTag}
            </span>
            <Tooltip title="Сменить пароль">
              <Button
                type="text"
                aria-label="Сменить пароль"
                icon={<KeyOutlined />}
                onClick={() => setPasswordOpen(true)}
              />
            </Tooltip>
            <Tooltip title={mode === "dark" ? "Светлая тема" : "Тёмная тема"}>
              <Button
                type="text"
                aria-label="Переключить тему"
                icon={mode === "dark" ? <SunOutlined /> : <MoonOutlined />}
                onClick={toggle}
              />
            </Tooltip>
            <Tooltip title="Выйти">
              <Button type="text" aria-label="Выйти" icon={<LogoutOutlined />} onClick={logout} />
            </Tooltip>
          </div>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>

      <Modal
        title="Смена пароля"
        open={passwordOpen}
        onCancel={() => setPasswordOpen(false)}
        footer={null}
        destroyOnHidden
      >
        <ChangePasswordForm
          onDone={() => {
            setPasswordOpen(false);
            message.success("Пароль изменён");
          }}
        />
      </Modal>
    </Layout>
  );
}
