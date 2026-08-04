import { LockOutlined, UserOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Form, Input, Typography } from "antd";
import { useState } from "react";
import { useAuth } from "../auth";

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
      <Card style={{ width: 360 }}>
        <Typography.Title level={4} style={{ textAlign: "center", marginTop: 0 }}>
          Temnet Parser
        </Typography.Title>
        {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
        <Form layout="vertical" onFinish={submit} requiredMark={false}>
          <Form.Item
            name="username"
            label="Логин"
            rules={[{ required: true, message: "Введите логин" }]}
          >
            <Input prefix={<UserOutlined />} autoFocus autoComplete="username" />
          </Form.Item>
          <Form.Item
            name="password"
            label="Пароль"
            rules={[{ required: true, message: "Введите пароль" }]}
          >
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={busy}>
            Войти
          </Button>
        </Form>
      </Card>
    </div>
  );
}
