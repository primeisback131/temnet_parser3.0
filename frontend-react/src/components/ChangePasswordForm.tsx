import { Alert, Button, Form, Input } from "antd";
import { useState } from "react";
import { api } from "../api/client";

interface Props {
  /** Called once the backend accepted the new password. */
  onDone: () => void | Promise<void>;
}

interface Values {
  current: string;
  next: string;
  confirm: string;
}

/**
 * Self-service password change. The current password is required: the
 * backend uses it to prove the request comes from the account holder, not
 * from someone who found an unlocked screen.
 */
export default function ChangePasswordForm({ onDone }: Props) {
  const [form] = Form.useForm<Values>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (values: Values) => {
    setError(null);
    setBusy(true);
    try {
      await api.changePassword(values.current, values.next);
      form.resetFields();
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось сменить пароль");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Form form={form} layout="vertical" onFinish={submit} requiredMark={false}>
      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      <Form.Item
        name="current"
        label="Текущий пароль"
        rules={[{ required: true, message: "Введите текущий пароль" }]}
      >
        <Input.Password autoComplete="current-password" autoFocus />
      </Form.Item>
      <Form.Item
        name="next"
        label="Новый пароль"
        rules={[{ required: true, min: 8, message: "Минимум 8 символов" }]}
      >
        <Input.Password autoComplete="new-password" />
      </Form.Item>
      <Form.Item
        name="confirm"
        label="Повторите новый пароль"
        dependencies={["next"]}
        rules={[
          { required: true, message: "Повторите пароль" },
          ({ getFieldValue }) => ({
            validator: (_, value: string) =>
              !value || getFieldValue("next") === value
                ? Promise.resolve()
                : Promise.reject(new Error("Пароли не совпадают")),
          }),
        ]}
      >
        <Input.Password autoComplete="new-password" />
      </Form.Item>
      <Button type="primary" htmlType="submit" block loading={busy}>
        Сменить пароль
      </Button>
    </Form>
  );
}
