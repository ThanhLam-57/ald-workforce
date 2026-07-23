# Đặc tả công thức payroll

> Tài liệu này mô tả contract và thứ tự tính, chưa chốt con số nghiệp vụ và chưa được triển khai trong Prompt 0.

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

## 4. Công thức cấu hình, chưa chốt

### Lương prorated

```text
proratedSalary = round(baseSalary × eligibleWorkUnits / standardWorkUnits)
```

Chưa chốt nguồn `standardWorkUnits`, xử lý ngày vào/nghỉ giữa tháng và cap.

### Tăng ca

Hai default có thể chọn sau:

- theo phút: `round(hourlyRate × overtimeMinutes / 60 × multiplier)`;
- theo block cấu hình: map tổng phút vào tier.

Không chọn mặc định bằng code cho tới khi nghiệp vụ xác nhận.

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

Cần xác nhận tier là bracket toàn phần hay marginal. Boundary test bắt buộc tại `lower - 1`, `lower`, `upper - 1`, `upper`.

### Phạt

Payroll cộng từ `violation.amountSnapshot`; không truy hồi mức hiện tại của rule. Chính sách sign canonical: amount snapshot luôn không âm, calculator đưa vào bucket `penalties`.

## 5. Rounding

Rounding policy phải versioned và định nghĩa:

- đơn vị: 1/10/100/1.000 VND;
- mode: half-up, half-even, floor hoặc ceiling;
- thời điểm: từng dòng, từng ngày, từng component hay chỉ tổng;
- xử lý rate/decimal trung gian.

Default đề xuất để thảo luận: integer VND, half-up ở từng breakdown line; chưa đưa vào implementation.

## 6. Validation và invariant

- Khoảng rule không overlap và cover đủ ngày có source.
- Source ID không lặp trong cùng component.
- Revenue/money input không âm trừ adjustment được phân loại rõ.
- Violation amount snapshot không âm.
- Tổng breakdown theo category bằng component output.
- Tổng component reconcile chính xác với `totalIncome`.
- Calculator không phụ thuộc thứ tự input.
- Serialize bigint thành string tại DTO boundary.

## 7. Golden tests cần có ở phase payroll

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
