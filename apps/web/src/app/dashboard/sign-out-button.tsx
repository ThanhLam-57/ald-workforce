"use client";

import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();

  return (
    <button
      className="text-sm font-medium text-slate-600 hover:text-slate-950"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/login");
        router.refresh();
      }}
      type="button"
    >
      Đăng xuất
    </button>
  );
}
