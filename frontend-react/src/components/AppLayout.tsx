import {
  BankOutlined,
  CustomerServiceOutlined,
  LineChartOutlined,
  MessageOutlined,
  MoonOutlined,
  SunOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { Button, Layout, Menu, Tooltip } from "antd";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { useThemeMode } from "../theme";

const { Header, Sider, Content } = Layout;

const items = [
  { key: "/chat", icon: <MessageOutlined />, label: "Чат" },
  { key: "/metrics", icon: <LineChartOutlined />, label: "Метрики" },
  { key: "/companies", icon: <BankOutlined />, label: "Статистика компаний" },
  { key: "/users", icon: <TeamOutlined />, label: "Статистика пользователей" },
  { key: "/operators", icon: <CustomerServiceOutlined />, label: "Операторы" },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, toggle } = useThemeMode();
  const selected = items.find((i) => location.pathname.startsWith(i.key))?.key ?? "/chat";

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider breakpoint="lg" collapsedWidth="0" theme="light">
        <div className="app-logo">Temnet Parser</div>
        <Menu
          mode="inline"
          theme="light"
          selectedKeys={[selected]}
          items={items}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header className="app-header">
          <span>{items.find((i) => i.key === selected)?.label}</span>
          <Tooltip title={mode === "dark" ? "Светлая тема" : "Тёмная тема"}>
            <Button
              type="text"
              aria-label="Переключить тему"
              icon={mode === "dark" ? <SunOutlined /> : <MoonOutlined />}
              onClick={toggle}
            />
          </Tooltip>
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
