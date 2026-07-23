# Đặc tả công thức payroll

> Tài liệu này là contract của payroll engine triển khai ở Prompt 5. Các mặc định
> tạm thời bên dưới là cấu hình/version được snapshot, không phải hằng số ẩn.

## 1. Nguyên tắc

- Hàm tính là pure function: cùng input/config cho cùng output.
- Không đọc database, clock hoặc environment bên trong domain calculator.
- Mọi tiền là số nguyên VND (`bigint` trong TypeScript); số công và tỷ lệ dùng decimal string/Decimal, không dùng floating point tùy ý.
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

### Lương prorated

```text
proratedSalary = round(baseSalary × eligibleWorkUnits / standardWorkUnits)
```

`standardWorkUnits` lấy từ `SALARY_RULES.standardWorkdays`. Kỳ chỉ được tính khi
một salary rule version bao phủ cả tháng. Nếu salary rule đổi giữa tháng, service
từ chối tính và yêu cầu GM tách/chốt policy mới.

TODO(BUSINESS): chốt prorate riêng cho nhân viên vào/nghỉ hoặc chuyển branch giữa tháng.

### Tăng ca

Prompt 5 dùng công thức theo phút đã typed trong `SALARY_RULES`:

```text
overtimePay =
  round(baseSalary / standardWorkdays / standardDailyMinutes
        × eligibleOvertimeMinutes × multiplierBps / 10.000)
```

`eligibleAfterMinutes` được trừ trên từng attendance day, không trên tổng tháng.

TODO(BUSINESS): bổ sung lịch ngày thường/cuối tuần/lễ hoặc block tier nếu cần.

### Thưởng doanh số

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

Daily rule được chọn theo từng business date. Monthly level rule được chọn tại
ngày cuối tháng; level hiện tại cũng là level hiệu lực tại ngày cuối tháng.

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
- Adjustment sau khóa tạo một revision DRAFT mới, copy snapshot input/adjustment
  được duyệt và lưu diff với revision nguồn; revision cũ không đổi.
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
