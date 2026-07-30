# Đặc tả công thức payroll

> Tài liệu này là contract của payroll engine triển khai ở Prompt 5. Các mặc định
> tạm thời bên dưới là cấu hình/version được snapshot, không phải hằng số ẩn.

## 1. Nguyên tắc

- Hàm tính là pure function: cùng input/config cho cùng output.
- Không đọc database, clock hoặc environment bên trong domain calculator.
- Tiền thưởng/phạt/lương là số nguyên VND (`bigint` trong TypeScript). Doanh số Live là
  số xu nguyên, không phải VND và không có phép quy đổi xu sang tiền. Số công và tỷ lệ
  dùng decimal string/Decimal, không dùng floating point tùy ý.
- Rule được chọn theo ngày phát sinh, không theo ngày chạy payroll.
- Calculation snapshot chứa input, output, rule version IDs, rounding policy version và source IDs.
- Publish rule tương lai không làm thay đổi snapshot kỳ đã tính/khóa.

## 2. Contract khái niệm

```ts
type PayrollInput = {
  period: { from: string; toExclusive: string; timezone: "Asia/Ho_Chi_Minh" };
  attendanceDays: readonly AttendanceInput[];
  levelIntervals: readonly LevelInterval[];
  salaryRule: VersionedRule<SalaryConfig>;
  dailyRewardRules: readonly VersionedRule<DailyRewardConfig>[];
  monthlyRewardRule: VersionedRule<MonthlyRewardConfig>;
  violations: readonly ViolationSnapshot[];
  adjustments: readonly ManualAdjustment[];
  rounding: RoundingPolicy;
};

type PayrollOutput = {
  baseSalary: bigint;
  proratedSalary: bigint;
  dailyRevenueBonus: bigint;
  monthlyRevenueBonus: bigint;
  attendanceBonus: bigint;
  achievementBonus: bigint;
  levelRankBonus: bigint;
  overtimePay: bigint;
  otherBonus: bigint;
  penalties: bigint;
  advance: bigint;
  totalIncome: bigint;
  breakdown: readonly BreakdownLine[];
};
```

## 3. Trình tự tính đề xuất

1. Chuẩn hóa và validate khoảng kỳ lương, source IDs và rule interval.
2. Chọn level/rule theo từng `workDate`.
3. Tính số công đủ điều kiện và lương prorated.
4. Tính tăng ca theo policy.
5. Tính thưởng doanh số từng ngày/tier.
6. Cộng doanh số tháng và tính thưởng tháng.
7. Tính attendance, achievement và level/rank bonus.
8. Cộng other bonus/adjustment.
9. Cộng penalty snapshot và advance.
10. Áp dụng rounding tại các điểm được policy chỉ định.
11. Reconcile:

```text
totalIncome =
  proratedSalary
  + dailyRevenueBonus
  + monthlyRevenueBonus
  + attendanceBonus
  + achievementBonus
  + levelRankBonus
  + overtimePay
  + otherBonus
  - penalties
  - advance
```

`baseSalary` là dữ liệu tham chiếu; chỉ `proratedSalary` được cộng vào tổng để tránh double count.

## 4. Công thức cấu hình và mặc định Prompt 5

### Lương theo công

```text
daysInMonth = số ngày dương lịch thực tế của kỳ theo Asia/Ho_Chi_Minh
standardPayableDays = daysInMonth - standardDaysOffPerMonth
probationWorkUnits = công hợp lệ trước officialDate
officialWorkUnits = công hợp lệ từ officialDate (inclusive)
weightedWorkUnits =
  probationWorkUnits × probationSalaryRateBps / 10.000
  + officialWorkUnits
proratedSalary = round(baseSalary × weightedWorkUnits / standardPayableDays)
```

`standardDaysOffPerMonth` lấy từ `SALARY_RULES`, có thể override theo branch/month.
Giá trị phải là số nguyên 0–30 và `standardPayableDays` phải lớn hơn 0. Rule cũ
chưa có trường này tiếp tục dùng `standardWorkdays` đã snapshot để tương thích
dữ liệu lịch sử. Kỳ chỉ được tính khi một salary rule version bao phủ cả tháng.

`probationSalaryRateBps` nằm trong `SALARY_RULES`; rule cũ thiếu trường này dùng
`8.500` (85%). `joinedDate` và `officialDate` là business date inclusive. Công trước
`joinedDate` không cộng vào lương cứng và sinh anomaly `WORK_BEFORE_JOIN_DATE`.
Nếu thiếu `officialDate`, nhân viên `PROBATION` dùng tỷ lệ thử việc; `OFFICIAL`,
`CONTRACTOR` và `INTERN` giữ 100% để tương thích dữ liệu cũ.

Chỉ `proratedSalary` dùng tỷ lệ thử việc. Tăng ca, thưởng, phạt, tạm ứng và các
adjustment khác giữ nguyên công thức/snapshot. Snapshot lưu ngày gia nhập, ngày
chính thức, tỷ lệ, số công và số tiền của từng giai đoạn. Kỳ đã `LOCKED` hoặc
`PUBLISHED` không bị sửa khi hồ sơ nhân viên thay đổi.

TODO(BUSINESS): chốt prorate riêng cho trường hợp chuyển branch giữa tháng.

### Tăng ca

Prompt 5 dùng công thức theo phút đã typed trong `SALARY_RULES`:

```text
overtimePay =
  round(baseSalary / standardPayableDays / standardDailyMinutes
        × eligibleOvertimeMinutes × multiplierBps / 10.000)
```

`eligibleAfterMinutes` được trừ trên từng attendance day, không trên tổng tháng.

TODO(BUSINESS): bổ sung lịch ngày thường/cuối tuần/lễ hoặc block tier nếu cần.

### Thưởng theo xu ngày và mốc xu tháng

Rule version chứa ordered tiers với biên rõ ràng:

```ts
type Tier = {
  lowerInclusive: bigint;
  upperExclusive: bigint | null;
  rewardType: "FIXED" | "RATE";
  rewardValue: string;
};
```

Tier hiện là fixed, whole-tier; biên inclusive/exclusive nằm trong config. Boundary
test bắt buộc tại `lower - 1`, `lower`, `upper - 1`, `upper`.

Daily rule được chọn theo từng business date và nhận `dailyCoins` nguyên. Hệ thống
lấy mốc cao nhất không vượt quá số xu ngày đó; `rewardAmount` của mốc là VND.

Mốc tháng được chọn bằng mốc cao nhất có `monthlyCoinThreshold <= monthlyCoins`.
Các khoản thưởng tháng đều là VND:

```text
workedDayCount =
  COUNT DISTINCT businessDate
  WHERE workUnits > 0

attendanceBonus =
  level.attendanceBonus nếu workedDayCount >= attendanceRequiredDays, ngược lại 0

achievementBonus = level.achievementBonus nếu đạt level, ngược lại 0

levelTransition =
  NONE   nếu thiếu bậc tháng trước hoặc tháng này
  RETAIN nếu hai bậc bằng nhau
  JUMP   nếu thứ tự bậc tháng này cao hơn tháng trước
  DOWN   nếu thứ tự bậc tháng này thấp hơn tháng trước

levelBonus =
  level.retainLevelBonus nếu RETAIN
  level.jumpLevelBonus nếu JUMP
  0 nếu NONE hoặc DOWN
```

Điều kiện chuyên cần dùng **ngày làm việc**, không dùng tổng số công:

- ngày có `workUnits > 0` được tính đúng một ngày, không phụ thuộc trạng thái;
- 0,5 công hay 1,5 công trong một ngày vẫn chỉ là một ngày;
- ngày có 0 công và số phút tăng ca không làm tăng số ngày.

Mặc định cấu hình ban đầu là 26 ngày trở lên, nhưng giá trị thực tế luôn lấy từ
`MONTHLY_LEVEL_RULES.attendanceRequiredDays` và được snapshot cùng payroll.

Nguồn xu tháng trước được chọn theo thứ tự ưu tiên:

1. snapshot phiếu lương tháng trước đã `PUBLISHED`;
2. tổng xu Attendance/Live của tháng trước;
3. số xu nền nhập tay cho nhân viên/kỳ hiện tại;
4. không có dữ liệu.

Số xu nền nhập tay không sửa Attendance/Live và bị bỏ qua ngay khi có nguồn tự động.
Snapshot payroll lưu số xu, nguồn, bậc trước/bậc hiện tại, số ngày làm việc, điều kiện
chuyên cần và trạng thái chuyển bậc. Phiếu đã gửi không đổi khi rule hoặc dữ liệu nguồn
được chỉnh về sau.

### Phạt

Payroll cộng từ `violation.amountSnapshot`; không truy hồi mức hiện tại của rule. Chính sách sign canonical: amount snapshot luôn không âm, calculator đưa vào bucket `penalties`.

## 5. Rounding

Rounding policy phải versioned và định nghĩa:

- đơn vị: 1/10/100/1.000 VND;
- mode: half-up, half-even, floor hoặc ceiling;
- thời điểm: từng dòng, từng ngày, từng component hay chỉ tổng;
- xử lý rate/decimal trung gian.

Không có default trong calculator. Engine dùng chính `roundingPolicy` của salary
rule version (`unit`, `mode`, `applyAt`) và snapshot policy này cùng output.

## 6. Quyết định lifecycle Prompt 5

- Một kỳ khóa/publish không được sửa period, entry, line, snapshot hoặc adjustment.
- Sửa worksheet hoặc adjustment sau khi gửi tự tạo một working revision mới,
  copy snapshot/override/adjustment và lưu nguồn; UI không yêu cầu người dùng quản
  lý revision. Revision đã publish không đổi.
- Worksheet override tách khỏi Attendance/LiveMetric/Violation. Reset một ô sẽ dùng
  lại giá trị nguồn/tự tính; giá trị `0` và correction âm là override hợp lệ.
- Recalculate dùng canonical input hash. Hash không đổi thì trả lại calculation
  hiện tại, không sinh snapshot/line trùng.
- `CORRECTION` được phép âm hoặc dương; `OTHER_BONUS`, `ADVANCE`, penalty luôn
  không âm. Advance và penalty bị trừ ở reconcile.
- `totalIncome` âm không bị floor. UI gắn anomaly `NEGATIVE_TOTAL`.
  TODO(BUSINESS): chốt gross/net/debt/carry-forward riêng.
- Payroll không bao gồm thuế/bảo hiểm vì chưa có rule/config đã xác nhận.
  TODO(BUSINESS): bổ sung rule typed và breakdown khi chính sách được duyệt.
- Payslip PDF dùng template `PAYSLIP_V1`, Noto Sans và không watermark/chữ ký.
  TODO(DESIGN): đối chiếu ảnh tham chiếu khi `docs/references/` được cung cấp.
- `pnpm db:seed` tạo cơ sở `DEMO`, staff `LIVEDEMO`, source attendance/rules và
  PayrollPeriod DRAFT cho tháng `SEED_PAYROLL_MONTH` (mặc định tháng hiện tại);
  GM mở dashboard và bấm Calculate để tạo snapshot bằng đúng production engine.

## 7. Validation và invariant

- Khoảng rule không overlap và cover đủ ngày có source.
- Source ID không lặp trong cùng component.
- Revenue/money input không âm trừ adjustment được phân loại rõ.
- Violation amount snapshot không âm.
- Tổng breakdown theo category bằng component output.
- Tổng component reconcile chính xác với `totalIncome`.
- Calculator không phụ thuộc thứ tự input.
- Serialize bigint thành string tại DTO boundary.

## 8. Golden tests cần có ở phase payroll

- Không có ngày công.
- 0.5/1.0 work unit và tổng decimal.
- Ngày đúng biên tier và một đơn vị dưới/trên biên.
- Rule đổi giữa kỳ.
- Level đổi giữa ngày/kỳ theo policy đã chốt.
- Nhiều lỗi một ngày và penalty bằng 0.
- Tăng ca không tròn giờ.
- Adjustment âm/dương, advance lớn hơn gross.
- Rounding tạo chênh 1 VND.
- Publish rule tương lai không đổi snapshot cũ.
- Recalculate cùng snapshot cho checksum/output giống nhau.
