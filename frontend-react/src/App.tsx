import { LockOutlined } from "@ant-design/icons";
import { Button, Result, Spin } from "antd";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";
import { useAuth } from "./auth";
import AppLayout from "./components/AppLayout";
import AdminUsersPage from "./pages/AdminUsersPage";
import ChangePasswordPage from "./pages/ChangePasswordPage";
import ChatPage from "./pages/ChatPage";
import CompaniesPage from "./pages/CompaniesPage";
import LoginPage from "./pages/LoginPage";
import MaintenancePage from "./pages/MaintenancePage";
import OperatorsPage from "./pages/OperatorsPage";
import UsersPage from "./pages/UsersPage";

// Lazy-loaded so the heavy ECharts bundle only loads when /metrics is visited.
const MetricsPage = lazy(() => import("./pages/MetricsPage"));

const centeredSpin = <Spin style={{ display: "block", margin: "80px auto" }} />;

/**
 * A section the account has no rights to, reached by a link or a typed URL.
 * It used to bounce to "home" in silence: a chat link on the metrics page
 * for a manager without chats just reopened the metrics page.
 */
function NoAccess({ section, home }: { section: string; home: string }) {
  const navigate = useNavigate();
  return (
    <Result
      status="warning"
      icon={<LockOutlined />}
      title={`Нет доступа к разделу «${section}»`}
      extra={
        <Button type="primary" onClick={() => navigate(home)}>
          На главную
        </Button>
      }
    />
  );
}

export default function App() {
  const { user, loading, startupError, retry, canUseChats, canViewMetrics } = useAuth();

  if (loading) {
    return centeredSpin;
  }
  if (startupError) {
    return (
      <Result
        status="warning"
        title={startupError.message}
        extra={
          <Button type="primary" onClick={retry}>
            Повторить
          </Button>
        }
      />
    );
  }
  if (!user) {
    return <LoginPage />;
  }
  // A temporary password has to be replaced first; the backend refuses every
  // other call anyway, so there is nothing else to show.
  if (user.mustChangePassword) {
    return <ChangePasswordPage />;
  }

  const isAdmin = user.role === "admin";
  // Chats are granted separately and metrics depend on the role, so where
  // "home" points depends on the rights.
  const home = canUseChats ? "/chat" : canViewMetrics ? "/metrics" : "/companies";
  const denied = (section: string) => <NoAccess section={section} home={home} />;

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to={home} replace />} />
        <Route path="/chat" element={canUseChats ? <ChatPage /> : denied("Чат")} />
        <Route
          path="/metrics"
          element={
            canViewMetrics ? <Suspense fallback={centeredSpin}><MetricsPage /></Suspense> : denied("Метрики")
          }
        />
        <Route path="/companies" element={<CompaniesPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/operators" element={canViewMetrics ? <OperatorsPage /> : denied("Операторы")} />
        <Route path="/admin/users" element={isAdmin ? <AdminUsersPage /> : denied("Учётные записи")} />
        <Route path="/admin/maintenance" element={isAdmin ? <MaintenancePage /> : denied("Обслуживание")} />
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}
