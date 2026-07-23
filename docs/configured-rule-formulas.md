# Công thức rule cấu hình

Các hàm dưới đây nằm trong `packages/domain` và dùng số nguyên/rational
arithmetic. Impact preview chỉ đọc dữ liệu lịch sử và không tạo payroll.

## Thưởng ngày

Mỗi bậc khai báo `minRevenue`, `maxRevenue | null`, cận đóng/mở,
`rewardAmount` và `priority`. Vì doanh số là số nguyên VND, validator quy đổi
mỗi khoảng thành giá trị nguyên đầu/cuối thực sự được chứa. Overlap luôn bị
từ chối; gap bị từ chối khi `gapPolicy = REQUIRE_CONTIGUOUS`.

```text
dailyReward(day) = rewardAmount của bậc chứa revenueAmount(day), hoặc 0
```

## Thưởng tháng và level

Level được chọn từ tổng doanh số tháng. Phần thưởng dự kiến:

```text
monthlyLevelAmount =
  monthlyRevenueBonus
  + attendanceBonus nếu đạt attendanceMinWorkUnits
  + achievementBonus nếu đạt achievementMinLiveMinutes
  + retainLevelBonus nếu giữ nguyên level
  + jumpLevelBonus nếu tăng ít nhất jumpMinLevelSteps
```

Đề xuất từ dữ liệu tháng `YYYY-MM` chỉ có hiệu lực từ ngày đầu tháng tiếp theo
sau khi GM xác nhận/override.

## Lương cơ bản và tăng ca

```text
proratedBase = baseSalary × eligibleWorkHundredths / standardWorkdayHundredths

overtime =
  baseSalary × 100 × eligibleOvertimeMinutes × multiplierBps
  / (standardWorkdayHundredths × standardDailyMinutes × 10.000)
```

`eligibleWork` lấy theo `WORK_UNITS` hoặc `PRESENT_DAYS`; policy quyết định
trạng thái attendance hợp lệ, ngưỡng đủ lương và việc cap ở ngày công chuẩn.
Rounding hỗ trợ đơn vị 1/10/100/1.000 VND, half-up, half-even, floor, ceiling,
áp dụng theo component hoặc tổng.

## KPI template

Tổng `weightBps` phải bằng 10.000. Điểm tối đa có trọng số:

```text
maximumWeightedScore = Σ(maxScore × weightBps / 10.000)
```

Template lưu riêng yêu cầu evidence/note cho từng tiêu chí; không lưu hoặc chạy
code trong database.
