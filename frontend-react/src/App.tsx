import { Spin } from "antd";
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
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

export default function App() {
  const { user, loading, canUseChats, canViewMetrics } = useAuth();

  if (loading) {
    return centeredSpin;
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

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to={home} replace />} />
        {canUseChats && <Route path="/chat" element={<ChatPage />} />}
        {canViewMetrics && (
          <Route
            path="/metrics"
            element={<Suspense fallback={centeredSpin}><MetricsPage /></Suspense>}
          />
        )}
        <Route path="/companies" element={<CompaniesPage />} />
        <Route path="/users" element={<UsersPage />} />
        {canViewMetrics && <Route path="/operators" element={<OperatorsPage />} />}
        {isAdmin && <Route path="/admin/users" element={<AdminUsersPage />} />}
        {isAdmin && <Route path="/admin/maintenance" element={<MaintenancePage />} />}
        <Route path="*" element={<Navigate to={home} replace />} />
      </Route>
    </Routes>
  );
}
