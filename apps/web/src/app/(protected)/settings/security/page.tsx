import { ChangePasswordForm } from "@/app/change-password/password-form";
import { TwoFactorSettings } from "@/app/dashboard/two-factor-settings";

import { PageHeader } from "../../page-header";
import { requirePageActor } from "../../page-access";

export default async function SecuritySettingsPage() {
  const actor = await requirePageActor(["GENERAL_MANAGER", "TRAINING_MANAGER", "LIVE_EMPLOYEE"]);

  return (
    <>
      <PageHeader
        description="Cập nhật mật khẩu và tăng cường bảo vệ tài khoản của bạn."
        eyebrow="Cài đặt cá nhân"
        title="Bảo mật tài khoản"
      />
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold">Đổi mật khẩu</h2>
          <p className="mt-1 text-sm text-slate-600">
            Mật khẩu mới cần đủ độ mạnh và khác mật khẩu đang sử dụng.
          </p>
          <ChangePasswordForm required={false} />
        </section>
        {actor.role === "GENERAL_MANAGER" ? (
          <TwoFactorSettings enabled={Boolean(actor.twoFactorEnabled)} />
        ) : (
          <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-lg font-semibold">Xác thực hai lớp</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Tính năng 2FA hiện được áp dụng cho tài khoản Tổng quản lý. Tài khoản của bạn vẫn được
              bảo vệ bằng phiên đăng nhập bảo mật và chính sách mật khẩu mạnh.
            </p>
          </section>
        )}
      </div>
    </>
  );
}
