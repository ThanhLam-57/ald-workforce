"use client";

import { Button } from "@ald/ui";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

type Option = Readonly<{ id: string; label: string }>;

type FoundationAdminProps = Readonly<{
  branches: readonly Option[];
  staff: readonly Option[];
}>;

function field(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

function FormCard({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function FoundationAdmin({ branches, staff }: FoundationAdminProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function post(
    event: FormEvent<HTMLFormElement>,
    path: string,
    body: (form: FormData) => Record<string, unknown>,
  ) {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body(form)),
      });
      if (!response.ok) {
        const payload: unknown = await response.json();
        const errorMessage =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "object" &&
          payload.error !== null &&
          "message" in payload.error &&
          typeof payload.error.message === "string"
            ? payload.error.message
            : "Không thể lưu dữ liệu.";
        throw new Error(errorMessage);
      }

      event.currentTarget.reset();
      setMessage("Đã lưu và ghi audit thành công.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không thể lưu dữ liệu.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-8">
      <div className="mb-4 flex min-h-10 items-center justify-between gap-4">
        <h2 className="text-xl font-semibold">Quản trị nền tảng</h2>
        {message ? (
          <p aria-live="polite" className="text-sm text-slate-600">
            {message}
          </p>
        ) : null}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <FormCard title="Tạo cơ sở">
          <form
            className="grid gap-3"
            onSubmit={(event) =>
              post(event, "/api/branches", (form) => ({
                code: field(form, "code"),
                name: field(form, "name"),
                address: field(form, "address") || undefined,
                reason: field(form, "reason"),
              }))
            }
          >
            <input name="code" placeholder="Mã cơ sở" required />
            <input name="name" placeholder="Tên cơ sở" required />
            <input name="address" placeholder="Địa chỉ (không bắt buộc)" />
            <input name="reason" placeholder="Lý do tạo" required />
            <Button disabled={pending}>Tạo cơ sở</Button>
          </form>
        </FormCard>

        <FormCard title="Tạo nhân sự">
          <form
            className="grid gap-3"
            onSubmit={(event) =>
              post(event, "/api/staff", (form) => ({
                staffCode: field(form, "staffCode"),
                fullName: field(form, "fullName"),
                streamingAlias: field(form, "streamingAlias") || null,
                email: field(form, "email") || undefined,
                jobTitle: field(form, "jobTitle"),
                employmentCategory: field(form, "employmentCategory"),
                reason: field(form, "reason"),
              }))
            }
          >
            <input name="staffCode" placeholder="Mã nhân viên" required />
            <input name="fullName" placeholder="Họ và tên" required />
            <input name="streamingAlias" placeholder="ACC / alias Live" />
            <input name="email" placeholder="Email (không bắt buộc)" type="email" />
            <input name="jobTitle" placeholder="Vị trí công việc" required />
            <select defaultValue="OFFICIAL" name="employmentCategory">
              <option value="OFFICIAL">Chính thức</option>
              <option value="PROBATION">Thử việc</option>
              <option value="CONTRACTOR">Hợp đồng</option>
              <option value="INTERN">Thực tập</option>
            </select>
            <input name="reason" placeholder="Lý do tạo" required />
            <Button disabled={pending}>Tạo nhân sự</Button>
          </form>
        </FormCard>

        <FormCard title="Phân công cơ sở">
          <form
            className="grid gap-3"
            onSubmit={(event) =>
              post(event, "/api/assignments", (form) => ({
                staffId: field(form, "staffId"),
                branchId: field(form, "branchId"),
                assignmentType: field(form, "assignmentType"),
                effectiveFrom: field(form, "effectiveFrom"),
                effectiveTo: null,
                reason: field(form, "reason"),
              }))
            }
          >
            <select name="staffId" required>
              <option value="">Chọn nhân sự</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.label}
                </option>
              ))}
            </select>
            <select name="branchId" required>
              <option value="">Chọn cơ sở</option>
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.label}
                </option>
              ))}
            </select>
            <select defaultValue="MEMBER" name="assignmentType">
              <option value="MEMBER">Nhân viên cơ sở</option>
              <option value="PRIMARY_MANAGER">Quản lý chính</option>
              <option value="SECONDARY_MANAGER">Quản lý hỗ trợ</option>
            </select>
            <label className="grid gap-1 text-sm">
              Hiệu lực từ
              <input name="effectiveFrom" required type="date" />
            </label>
            <input name="reason" placeholder="Lý do phân công" required />
            <Button disabled={pending || branches.length === 0 || staff.length === 0}>
              Tạo phân công
            </Button>
          </form>
        </FormCard>

        <FormCard title="Cấp tài khoản">
          <form
            className="grid gap-3"
            onSubmit={(event) =>
              post(event, "/api/users", (form) => ({
                email: field(form, "email"),
                username: field(form, "username"),
                password: field(form, "password"),
                name: field(form, "name"),
                role: field(form, "role"),
                staffId: field(form, "staffId") || null,
                reason: field(form, "reason"),
              }))
            }
          >
            <input name="name" placeholder="Tên hiển thị" required />
            <input name="email" placeholder="Email đăng nhập" required type="email" />
            <input name="username" placeholder="Tên đăng nhập" required />
            <input
              autoComplete="new-password"
              minLength={12}
              name="password"
              placeholder="Mật khẩu tạm (ít nhất 12 ký tự)"
              required
              type="password"
            />
            <select defaultValue="LIVE_EMPLOYEE" name="role">
              <option value="TRAINING_MANAGER">Quản lý đào tạo</option>
              <option value="LIVE_EMPLOYEE">Nhân viên Live</option>
              <option value="GENERAL_MANAGER">Tổng quản lý</option>
            </select>
            <select name="staffId">
              <option value="">Không liên kết nhân sự</option>
              {staff.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.label}
                </option>
              ))}
            </select>
            <input name="reason" placeholder="Lý do cấp tài khoản" required />
            <Button disabled={pending}>Cấp tài khoản</Button>
          </form>
        </FormCard>
      </div>
    </div>
  );
}
