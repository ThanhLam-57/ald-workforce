import { describe, expect, it } from "vitest";

import { staffProfileFieldErrorsFrom } from "./staff-profile-field-errors";

describe("staffProfileFieldErrorsFrom", () => {
  it("đọc lỗi Zod flatten theo từng trường", () => {
    expect(
      staffProfileFieldErrorsFrom({
        error: {
          fields: {
            fieldErrors: {
              staffCode: ["Mã hồ sơ không hợp lệ."],
              email: ["Email không hợp lệ."],
            },
          },
        },
      }),
    ).toEqual({
      staffCode: ["Mã hồ sơ không hợp lệ."],
      email: ["Email không hợp lệ."],
    });
  });

  it("đọc lỗi nghiệp vụ có cấu trúc cho mã máy chấm công", () => {
    expect(
      staffProfileFieldErrorsFrom(
        {
          error: {
            message: "Mã máy chấm công đã được dùng.",
            details: {
              fieldErrors: {
                attendanceMachineCode: ["Mã máy chấm công đã được dùng."],
              },
            },
          },
        },
        409,
      ),
    ).toEqual({
      attendanceMachineCode: ["Mã máy chấm công đã được dùng."],
    });
  });

  it("không gán một conflict không liên quan vào mã máy chấm công", () => {
    expect(
      staffProfileFieldErrorsFrom(
        { error: { message: "Hồ sơ đã được cập nhật bởi người khác." } },
        409,
      ),
    ).toEqual({});
  });
});
