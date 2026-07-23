"use client";

import { Button } from "@ald/ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth-client";

export function TwoFactorForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [backupMode, setBackupMode] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const result = backupMode
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice });
    setPending(false);
    if (result.error) {
      setError("Mã xác thực không đúng, đã dùng hoặc tài khoản đang tạm khóa.");
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  }

  return (
    <form className="mt-6 space-y-5" onSubmit={submit}>
      <label className="block space-y-2">
        <span className="text-sm font-medium">{backupMode ? "Mã dự phòng" : "Mã 6 chữ số"}</span>
        <input
          autoComplete="one-time-code"
          className="w-full"
          inputMode={backupMode ? "text" : "numeric"}
          onChange={(event) => setCode(event.target.value.trim())}
          required
          value={code}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          checked={trustDevice}
          onChange={(event) => setTrustDevice(event.target.checked)}
          type="checkbox"
        />
        Tin cậy thiết bị này trong 14 ngày
      </label>
      {error ? <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
      <Button className="w-full" disabled={pending} type="submit">
        {pending ? "Đang xác thực…" : "Xác thực"}
      </Button>
      <button
        className="w-full text-sm text-sky-700 underline"
        onClick={() => {
          setBackupMode((value) => !value);
          setCode("");
          setError(null);
        }}
        type="button"
      >
        {backupMode ? "Dùng mã từ ứng dụng" : "Dùng mã dự phòng"}
      </button>
    </form>
  );
}
