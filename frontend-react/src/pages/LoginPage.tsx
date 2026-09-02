import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input } from "antd";
import { useState } from "react";
import { useAuth } from "../auth";
import BrandMark from "../components/BrandMark";

export default function LoginPage() {
  const { login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (values: { username: string; password: string }) => {
    setBusy(true);
    setError(null);
    try {
      await login(values.username.trim(), values.password);
    } catch {
      // The backend never says which half was wrong; neither do we.
      setError("Неверный логин или пароль");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <div className="login-card">
        <div className="login-brand">
          <span className="app-brand-mark" style={{ width: 40, height: 40, flexBasis: 40, borderRadius: 12 }}>
            <BrandMark size={22} />
          </span>
          <div>
            <div className="login-brand-name">Temnet Parser</div>
            <div className="login-brand-sub">аналитика поддержки</div>
          </div>
        </div>
        <Card styles={{ body: { padding: 24 } }}>
          {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
          <Form layout="vertical" onFinish={submit} requiredMark={false} size="large">
            <Form.Item name="username" label="Логин" rules={[{ required: true, message: "Введите логин" }]}>
              <Input prefix={<UserOutlined />} autoFocus autoComplete="username" />
            </Form.Item>
            <Form.Item
              name="password"
              label="Пароль"
              rules={[{ required: true, message: "Введите пароль" }]}
              style={{ marginBottom: 20 }}
            >
              <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block loading={busy}>
              Войти
            </Button>
          </Form>
        </Card>
      </div>
    </div>
  );
}
