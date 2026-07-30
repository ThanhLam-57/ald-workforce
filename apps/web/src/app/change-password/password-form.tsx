"use client";

import { Button } from "@ald/ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

export function ChangePasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmation) {
      setError("Xác nhận mật khẩu chưa khớp.");
      return;
    }
    setPending(true);
    setError(null);
    const response = await fetch("/api/account/change-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const payload = (await response.json()) as { error?: { message?: string } };
    setPending(false);
    if (!response.ok) {
      setError(payload.error?.message ?? "Không thể đổi mật khẩu.");
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form className="mt-6 space-y-5" onSubmit={submit}>
      <label className="block space-y-2">
        <span className="text-sm font-medium">Mật khẩu hiện tại</span>
        <input
          autoComplete="current-password"
          className="w-full"
          onChange={(event) => setCurrentPassword(event.target.value)}
          required
          type="password"
          value={currentPassword}
        />
      </label>
      <label className="block space-y-2">
        <span className="text-sm font-medium">Mật khẩu mới</span>
        <input
          autoComplete="new-password"
          className="w-full"
          minLength={12}
          onChange={(event) => setNewPassword(event.target.value)}
          required
          type="password"
          value={newPassword}
        />
      </label>
      <label className="block space-y-2">
        <span className="text-sm font-medium">Nhập lại mật khẩu mới</span>
        <input
          autoComplete="new-password"
          className="w-full"
          minLength={12}
          onChange={(event) => setConfirmation(event.target.value)}
          required
          type="password"
          value={confirmation}
        />
      </label>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      <Button className="w-full" disabled={pending} type="submit">
        {pending ? "Đang cập nhật…" : "Đổi mật khẩu"}
      </Button>
    </form>
  );
}
