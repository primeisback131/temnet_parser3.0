import { Alert, App, Button, Card, Typography } from "antd";
import { useAuth } from "../auth";
import ChangePasswordForm from "../components/ChangePasswordForm";

/**
 * Shown instead of the application while the account holds a temporary
 * password (the one an administrator issued, or the generated install
 * password). The backend refuses every other call until it is replaced.
 */
export default function ChangePasswordPage() {
  const { user, refresh, logout } = useAuth();
  const { message } = App.useApp();

  return (
    <div className="login-screen">
      <Card style={{ width: 400 }}>
        <Typography.Title level={4} style={{ textAlign: "center", marginTop: 0 }}>
          Смена пароля
        </Typography.Title>
        <Alert
          type="warning"
          showIcon
          message="Вы вошли с временным паролем"
          description="Придумайте свой пароль, чтобы продолжить работу. Временный пароль после этого перестанет действовать."
          style={{ marginBottom: 16 }}
        />
        <ChangePasswordForm
          onDone={async () => {
            message.success("Пароль изменён");
            await refresh();
          }}
        />
        <Button type="link" block onClick={() => void logout()} style={{ marginTop: 8 }}>
          Выйти{user ? ` (${user.username})` : ""}
        </Button>
      </Card>
    </div>
  );
}
