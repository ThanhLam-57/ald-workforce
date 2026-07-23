"use client";

import { Button } from "@ald/ui";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";

export function TwoFactorSettings({ enabled: initialEnabled }: { enabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function enable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await authClient.twoFactor.enable({ password });
    setPending(false);
    if (result.error || !result.data) {
      setError("Không thể bật xác thực hai lớp. Hãy kiểm tra mật khẩu.");
      return;
    }
    setTotpUri(result.data.totpURI);
    setBackupCodes(result.data.backupCodes);
  }

  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (result.error) {
      setError("Mã xác thực không đúng hoặc đã hết hạn.");
      return;
    }
    setEnabled(true);
    setTotpUri(null);
    setCode("");
    setPassword("");
  }

  async function disable() {
    setPending(true);
    setError(null);
    const result = await authClient.twoFactor.disable({ password });
    setPending(false);
    if (result.error) {
      setError("Không thể tắt xác thực hai lớp. Hãy kiểm tra mật khẩu.");
      return;
    }
    setEnabled(false);
    setPassword("");
    setBackupCodes([]);
  }

  return (
    <details className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
      <summary className="cursor-pointer font-semibold">
        Bảo mật tài khoản · 2FA {enabled ? "đang bật" : "chưa bật"}
      </summary>
      <div className="mt-4 max-w-2xl space-y-4 text-sm">
        <p className="text-slate-600">
          Dùng ứng dụng tạo mã TOTP. Lưu mã dự phòng ở nơi an toàn, không đưa vào ghi chú chung hoặc
          ticket hỗ trợ.
        </p>
        {!totpUri ? (
          <form className="flex flex-wrap items-end gap-3" onSubmit={enabled ? undefined : enable}>
            <label className="min-w-64 flex-1 space-y-1">
              <span className="font-medium">Mật khẩu hiện tại</span>
              <input
                autoComplete="current-password"
                className="w-full"
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>
            {enabled ? (
              <Button disabled={pending || !password} onClick={() => void disable()} type="button">
                Tắt 2FA
              </Button>
            ) : (
              <Button disabled={pending} type="submit">
                Bật 2FA
              </Button>
            )}
          </form>
        ) : (
          <>
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="font-medium">URI cấu hình TOTP</p>
              <code className="mt-2 block break-all text-xs">{totpUri}</code>
            </div>
            <form className="flex flex-wrap items-end gap-3" onSubmit={verify}>
              <label className="space-y-1">
                <span className="font-medium">Mã 6 chữ số</span>
                <input
                  autoComplete="one-time-code"
                  className="w-48"
                  inputMode="numeric"
                  maxLength={6}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                  pattern="[0-9]{6}"
                  required
                  value={code}
                />
              </label>
              <Button disabled={pending || code.length !== 6} type="submit">
                Xác nhận
              </Button>
            </form>
            {backupCodes.length ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="font-medium text-amber-900">Mã dự phòng — chỉ hiển thị lúc này</p>
                <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs">
                  {backupCodes.map((backupCode) => (
                    <span key={backupCode}>{backupCode}</span>
                  ))}
                </div>
              </div>
            ) : null}
          </>
        )}
        {error ? <p className="rounded-lg bg-red-50 p-3 text-red-700">{error}</p> : null}
      </div>
    </details>
  );
}
