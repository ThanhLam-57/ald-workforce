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

`workedDayCount` đếm số ngày nghiệp vụ khác nhau có `workUnits > 0`, không phụ
thuộc trạng thái attendance. Một ngày 0,5 công vẫn là một ngày; tăng ca không tạo
thêm ngày.

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

`eligibleWork` lấy theo `WORK_UNITS` hoặc số ngày có `workUnits > 0`; trạng thái
attendance không tham gia công thức. Policy vẫn quyết định ngưỡng đủ lương và
việc cap ở ngày công chuẩn.
Rounding hỗ trợ đơn vị 1/10/100/1.000 VND, half-up, half-even, floor, ceiling,
áp dụng theo component hoặc tổng.

## Lỗi tự động theo ca nhân viên

Rule `CHECK_IN_LATE` và `LIVE_DURATION_SHORT` chọn một trong hai nguồn ngưỡng:

- `STAFF_SHIFT`: lấy ca của nhân viên có khoảng hiệu lực chứa ngày nghiệp vụ.
- `RULE_FIXED`: dùng trực tiếp giờ/thời lượng cố định trong rule để tương thích
  cấu hình cũ.

```text
lateThreshold = scheduledStartMinutes + graceMinutes
liveThreshold = max(0, requiredLiveMinutes - graceMinutes)
```

Check-in sau `lateThreshold` mới bị tính đi muộn. Live thực tế thấp hơn
`liveThreshold` mới bị tính thiếu Live. Nếu rule dùng `STAFF_SHIFT` nhưng ngày đó
không có ca hiệu lực, kết quả là `INSUFFICIENT_DATA`: không tự tạo tiền phạt và UI
phải cảnh báo để người quản lý bổ sung ca. Violation đã tạo vẫn snapshot rule, ca,
ngưỡng thực tế và mức tiền tại thời điểm đánh giá.

## KPI template

Tổng `weightBps` phải bằng 10.000. Điểm tối đa có trọng số:

```text
maximumWeightedScore = Σ(maxScore × weightBps / 10.000)
```

Template lưu riêng yêu cầu evidence/note cho từng tiêu chí; không lưu hoặc chạy
code trong database.
