# Công thức rule cấu hình

Các hàm dưới đây nằm trong `packages/domain` và dùng số nguyên/rational
arithmetic. Impact preview chỉ đọc dữ liệu lịch sử và không tạo payroll.

## Thưởng theo xu ngày

Mỗi bậc khai báo `minRevenue`, `maxRevenue | null`, cận đóng/mở,
`rewardAmount` và `priority`. Doanh số Live là số xu nguyên, không phải VND; validator quy đổi
mỗi khoảng thành giá trị nguyên đầu/cuối thực sự được chứa. Overlap luôn bị
từ chối; gap bị từ chối khi `gapPolicy = REQUIRE_CONTIGUOUS`.

```text
dailyReward(day) = rewardAmount của bậc chứa dailyCoins(day), hoặc 0 VND
```

## Mốc xu tháng và thưởng level

Level được chọn từ tổng xu tháng bằng mốc cao nhất không vượt quá tổng xu. Rule đơn giản
hiển thị các cột `name`, `monthlyCoinThreshold`, `attendanceBonus`,
`achievementBonus`, `retainLevelBonus`, `jumpLevelBonus`; trường cũ
`monthlyRevenueBonus` không tham gia công thức mới.

```text
monthlyLevelAmount =
  attendanceBonus nếu workedDayCount >= attendanceRequiredDays
  + achievementBonus nếu đạt level
  + retainLevelBonus nếu bậc tháng này bằng tháng trước
  + jumpLevelBonus nếu bậc tháng này cao hơn tháng trước
```

`retainLevelBonus` và `jumpLevelBonus` loại trừ nhau. Khi tụt bậc hoặc thiếu dữ liệu bậc,
cả hai bằng 0.

`workedDayCount` đếm số ngày nghiệp vụ khác nhau có `status=PRESENT` và
`workUnits > 0`. Một ngày 0,5 công vẫn là một ngày; tăng ca không tạo thêm ngày.

Nguồn xu tháng trước ưu tiên: payroll tháng trước đã publish, Attendance/Live tháng
trước, rồi mới tới số xu nền nhập tay. Số xu nền chỉ thuộc worksheet kỳ hiện tại và
không ghi ngược dữ liệu nguồn.

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
