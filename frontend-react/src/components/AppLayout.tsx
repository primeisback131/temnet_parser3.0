import {
  BankOutlined,
  CustomerServiceOutlined,
  DatabaseOutlined,
  LineChartOutlined,
  LogoutOutlined,
  MessageOutlined,
  MoonOutlined,
  SafetyOutlined,
  SunOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Button, Layout, Menu, Space, Tag, Tooltip, Typography } from "antd";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { useThemeMode } from "../theme";

const { Header, Sider, Content } = Layout;

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, toggle } = useThemeMode();
  const { user, logout, canUseChats, canViewMetrics } = useAuth();

  // The menu only offers what the backend would actually serve.
  const items = [
    ...(canUseChats ? [{ key: "/chat", icon: <MessageOutlined />, label: "Чат" }] : []),
    ...(canViewMetrics ? [{ key: "/metrics", icon: <LineChartOutlined />, label: "Метрики" }] : []),
    { key: "/companies", icon: <BankOutlined />, label: "Статистика компаний" },
    { key: "/users", icon: <TeamOutlined />, label: "Статистика пользователей" },
    ...(canViewMetrics
      ? [{ key: "/operators", icon: <CustomerServiceOutlined />, label: "Операторы" }]
      : []),
    ...(user?.role === "admin"
      ? [
          { key: "/admin/users", icon: <SafetyOutlined />, label: "Пользователи" },
          { key: "/admin/maintenance", icon: <DatabaseOutlined />, label: "Обслуживание" },
        ]
      : []),
  ];

  // Longest key first: /users must not swallow /admin/users.
  const selected =
    [...items]
      .sort((a, b) => b.key.length - a.key.length)
      .find((i) => location.pathname.startsWith(i.key))?.key ?? items[0]?.key;

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider breakpoint="lg" collapsedWidth="0" theme="light">
        <div className="app-logo">Temnet Parser</div>
        <Menu
          mode="inline"
          theme="light"
          selectedKeys={selected ? [selected] : []}
          items={items}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <span>{items.find((i) => i.key === selected)?.label}</span>
          <Space size="middle">
            <Space size={6}>
              <Typography.Text type="secondary">{user?.fullName || user?.username}</Typography.Text>
              {user?.role === "admin" && <Tag color="blue">админ</Tag>}
              {user?.role === "user" && <Tag>только просмотр</Tag>}
            </Space>
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
          </Space>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
