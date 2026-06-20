import { BankOutlined, LineChartOutlined, MessageOutlined, TeamOutlined } from "@ant-design/icons";
import { Layout, Menu } from "antd";
import { Outlet, useLocation, useNavigate } from "react-router-dom";

const { Header, Sider, Content } = Layout;

const items = [
  { key: "/chat", icon: <MessageOutlined />, label: "Чат" },
  { key: "/metrics", icon: <LineChartOutlined />, label: "Метрики" },
  { key: "/companies", icon: <BankOutlined />, label: "Статистика компаний" },
  { key: "/users", icon: <TeamOutlined />, label: "Статистика пользователей" },
];

export default function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
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
          {items.find((i) => i.key === selected)?.label}
        </Header>
        <Content className="app-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
