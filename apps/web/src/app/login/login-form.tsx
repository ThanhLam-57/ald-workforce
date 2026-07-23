"use client";

import { Button } from "@ald/ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";

export function LoginForm() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const result = identifier.includes("@")
      ? await authClient.signIn.email({ email: identifier, password })
      : await authClient.signIn.username({ username: identifier, password });

    setPending(false);
    if (result.error) {
      setError("Thông tin đăng nhập không đúng hoặc tài khoản đã bị vô hiệu hóa.");
      return;
    }

    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <label className="block space-y-2">
        <span className="text-sm font-medium">Email hoặc tên đăng nhập</span>
        <input
          autoComplete="username"
          className="w-full"
          onChange={(event) => setIdentifier(event.target.value)}
          required
          value={identifier}
        />
      </label>
      <label className="block space-y-2">
        <span className="text-sm font-medium">Mật khẩu</span>
        <input
          autoComplete="current-password"
          className="w-full"
          minLength={8}
          onChange={(event) => setPassword(event.target.value)}
          required
          type="password"
          value={password}
        />
      </label>
      {error ? (
        <p aria-live="polite" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      <Button className="w-full" disabled={pending} type="submit">
        {pending ? "Đang đăng nhập…" : "Đăng nhập"}
      </Button>
    </form>
  );
}
