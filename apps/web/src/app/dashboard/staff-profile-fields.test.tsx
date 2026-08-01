import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { StaffProfileFields, type StaffProfileEditorValues } from "./staff-profile-fields";
import { staffWorkspaceCapabilitiesFor } from "./staff-workspace-capabilities";

const values = {
  staffCode: "NV001",
  attendanceMachineCode: "00033",
  fullName: "Nguyễn Văn A",
  streamingAlias: "Kenh A",
  tiktokChannelId: "kenha",
  email: "a@example.com",
  phone: "0900000000",
  dateOfBirth: "2000-01-01",
  citizenIdNumber: "001234567890",
  bankAccountNumber: "123456",
  bankName: "Ngân hàng A",
  permanentAddress: "Địa chỉ A",
  temporaryAddress: "Địa chỉ B",
  facebookUrl: "https://facebook.com/a",
  university: "Đại học A",
  jobTitle: "Nhân viên Live",
  joinedDate: "2026-07-01",
  officialDate: "",
  employmentCategory: "PROBATION",
  employmentStatus: "ACTIVE",
  effectiveFrom: "2026-07-30",
  baseSalaryAmount: "7000000",
} satisfies StaffProfileEditorValues;

describe("StaffProfileFields", () => {
  it("hiển thị và cho GM sửa lương, mã máy", () => {
    const html = renderToStaticMarkup(
      <StaffProfileFields
        capabilities={staffWorkspaceCapabilitiesFor("GENERAL_MANAGER")}
        onChange={vi.fn()}
        today="2026-07-30"
        values={values}
      />,
    );

    expect(html).toContain("Lương cơ bản (VND)");
    expect(html).toContain('name="baseSalaryAmount"');
    expect(html).toContain('name="attendanceMachineCode"');
    expect(html).not.toContain('name="attendanceMachineCode" disabled=""');
  });

  it("loại lương khỏi markup của Training Manager nhưng vẫn cho sửa mã máy theo capability", () => {
    const html = renderToStaticMarkup(
      <StaffProfileFields
        capabilities={staffWorkspaceCapabilitiesFor("TRAINING_MANAGER")}
        onChange={vi.fn()}
        today="2026-07-30"
        values={values}
      />,
    );

    expect(html).not.toContain("Lương cơ bản (VND)");
    expect(html).not.toContain('name="baseSalaryAmount"');
    expect(html).toContain('name="attendanceMachineCode"');
    expect(html).not.toContain('name="attendanceMachineCode" disabled=""');
  });

  it("ẩn input mã máy đơn lẻ trong Administration vì mã thuộc từng assignment", () => {
    const html = renderToStaticMarkup(
      <StaffProfileFields
        capabilities={staffWorkspaceCapabilitiesFor("GENERAL_MANAGER")}
        onChange={vi.fn()}
        showAttendanceMachineCode={false}
        today="2026-07-30"
        values={values}
      />,
    );

    expect(html).not.toContain('name="attendanceMachineCode"');
    expect(html).toContain('name="staffCode"');
  });

  it("hiển thị mã nhân viên tự động ở chế độ chỉ đọc khi onboarding", () => {
    const html = renderToStaticMarkup(
      <StaffProfileFields
        capabilities={staffWorkspaceCapabilitiesFor("GENERAL_MANAGER")}
        onChange={vi.fn()}
        onRetryStaffCode={vi.fn()}
        staffCodeLoading
        staffCodeReadOnly
        staffCodeStatus="Đang tạo mã theo cơ sở đã chọn..."
        today="2026-07-30"
        values={values}
      />,
    );

    expect(html).toContain("Mã nhân viên");
    expect(html).toContain('name="staffCode"');
    expect(html).toContain('readOnly=""');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Thử tạo lại mã");
  });

  it("hiển thị lỗi của mọi trường hồ sơ ngay dưới input", () => {
    const errors = Object.fromEntries(
      Object.keys(values).map((field) => [field, [`Lỗi ${field}`]]),
    );
    const html = renderToStaticMarkup(
      <StaffProfileFields
        capabilities={staffWorkspaceCapabilitiesFor("GENERAL_MANAGER")}
        errors={errors}
        onChange={vi.fn()}
        showEmploymentControls
        today="2026-07-30"
        values={values}
      />,
    );

    for (const field of Object.keys(values)) {
      expect(html).toContain(`Lỗi ${field}`);
    }
    expect(html.match(/role="alert"/g)).toHaveLength(Object.keys(values).length);
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("aria-describedby=");
  });
});
