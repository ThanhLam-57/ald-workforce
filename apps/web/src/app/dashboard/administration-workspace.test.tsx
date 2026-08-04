import type { AdminAssignmentDto } from "@ald/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { AssignmentRows } from "./administration-workspace";

function assignment(status: AdminAssignmentDto["status"]): AdminAssignmentDto {
  return {
    id: `assignment-${status}`,
    branch: { id: "branch-1", code: "XT_01", name: "Xuân Thủy", isActive: true },
    staff: {
      id: "staff-1",
      staffCode: "NV_XT_001",
      fullName: "Quản lý Xuân Thủy",
      employmentStatus: "ACTIVE",
    },
    assignmentType: "PRIMARY_MANAGER",
    attendanceMachineCode: null,
    effectiveFrom: "2026-01-01",
    effectiveTo: status === "CURRENT" ? null : "2026-07-01",
    status,
    version: 1,
    updatedAt: "2026-08-04T00:00:00.000Z",
  };
}

describe("AssignmentRows", () => {
  it("cho phép kích hoạt lại phân công đã kết thúc", () => {
    const html = renderToStaticMarkup(
      <AssignmentRows items={[assignment("ENDED")]} onAction={vi.fn()} />,
    );

    expect(html).toContain("Kích hoạt lại");
  });

  it("không cho phục hồi bản ghi đã hủy", () => {
    const html = renderToStaticMarkup(
      <AssignmentRows items={[assignment("CANCELLED")]} onAction={vi.fn()} />,
    );

    expect(html).not.toContain("Kích hoạt lại");
  });
});
